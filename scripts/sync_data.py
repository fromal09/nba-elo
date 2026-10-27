"""
sync_data.py — keeps the generated site data (public/data) in object storage instead of git.

The site serves /data/* through a Vercel rewrite to the bucket's public URL, so the code that
fetches /data/... doesn't change. Works with Cloudflare R2 (the default) or any S3-compatible store.

  push   Upload files that changed since the last push, then write the manifest. Files the build
         didn't produce stay in the bucket; --prune deletes them. Refuses a build that lost seasons
         or games (see guard()).
           python3 scripts/sync_data.py push [--dry-run] [--prune]
  pull   Download files from the public URL (no credentials needed).
           python3 scripts/sync_data.py pull elo.json explorer/index.json
           python3 scripts/sync_data.py pull --all

Environment
  push: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
        (or S3_ENDPOINT instead of R2_ACCOUNT_ID for another S3-compatible store)
  pull: DATA_URL, the bucket's public base URL (e.g. https://pub-xxxx.r2.dev)

Objects live under data/<path>, next to data/_manifest.json ({path: md5}).
"""
import argparse, hashlib, json, mimetypes, os, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL = ROOT / "public" / "data"
PREFIX = "data/"
MANIFEST = PREFIX + "_manifest.json"
CACHE = "public, max-age=300, s-maxage=900"  # browsers recheck within 5 minutes, the CDN within 15


def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def local_files():
    return {p.relative_to(LOCAL).as_posix(): p for p in LOCAL.rglob("*") if p.is_file() and not p.name.startswith(".")}


def client():
    import boto3
    from botocore.config import Config
    endpoint = os.environ.get("S3_ENDPOINT") or f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3", endpoint_url=endpoint, region_name=os.environ.get("S3_REGION", "auto"),
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"], aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        config=Config(max_pool_connections=32, retries={"max_attempts": 6, "mode": "adaptive"},
                      request_checksum_calculation="when_required", response_checksum_validation="when_required"),
    )


def get_json(s3, bucket, key):
    try:
        return json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
    except s3.exceptions.NoSuchKey:
        return None
    except Exception as e:  # first push: bucket is empty
        if "NoSuchKey" in str(e) or "404" in str(e):
            return None
        raise


def guard(s3, bucket):
    """A build missing source CSVs drops seasons and games. Compare with what the site serves now."""
    old = get_json(s3, bucket, PREFIX + "explorer/index.json")
    new_p = LOCAL / "explorer" / "index.json"
    if old and new_p.exists():
        new = json.loads(new_p.read_text())
        count = lambda d: (len(d["seasons"]), sum(s["games"] for s in d["seasons"]))
        (os_, og), (ns, ng) = count(old), count(new)
        print(f"Seasons {os_} -> {ns}, games {og:,} -> {ng:,}")
        if ns < os_ or ng < og:
            missing = sorted({s["season"] for s in old["seasons"]} - {s["season"] for s in new["seasons"]})
            sys.exit(f"::error::The build has fewer seasons or games than the live data (missing: {', '.join(missing) or 'none'}). Not uploading.")


def push(args):
    bucket = os.environ["R2_BUCKET"]
    s3 = client()
    remote = get_json(s3, bucket, MANIFEST) or {}
    files = local_files()
    if not files:
        sys.exit("::error::public/data is empty; run the build first.")
    print(f"Hashing {len(files):,} local files…")
    with ThreadPoolExecutor(8) as ex:
        local = dict(zip(files, ex.map(md5, files.values())))
    guard(s3, bucket)
    changed = [k for k, h in local.items() if remote.get(k) != h]
    removed = [k for k in remote if k not in local] if args.prune else []
    kept = {k: h for k, h in remote.items() if k not in local and k not in removed}
    size = sum(files[k].stat().st_size for k in changed)
    print(f"{len(changed):,} to upload ({size / 1e6:.1f} MB), {len(removed):,} to delete, {len(local) - len(changed):,} unchanged")
    if args.dry_run:
        for k in changed[:20]:
            print("  +", k)
        return

    def up(k):
        ctype = mimetypes.guess_type(k)[0] or "application/octet-stream"
        if k.endswith(".json"):
            ctype = "application/json; charset=utf-8"
        s3.upload_file(str(files[k]), bucket, PREFIX + k, ExtraArgs={"ContentType": ctype, "CacheControl": CACHE})
        return k

    done = 0
    with ThreadPoolExecutor(24) as ex:
        for f in as_completed([ex.submit(up, k) for k in changed]):
            f.result()
            done += 1
            if done % 500 == 0:
                print(f"  {done:,}/{len(changed):,}")
    for i in range(0, len(removed), 1000):
        batch = [{"Key": PREFIX + k} for k in removed[i:i + 1000]]
        s3.delete_objects(Bucket=bucket, Delete={"Objects": batch, "Quiet": True})
    # The manifest goes last, so a failed run is retried in full next time
    manifest = {**kept, **local}
    s3.put_object(Bucket=bucket, Key=MANIFEST, Body=json.dumps(manifest, separators=(",", ":")).encode(),
                  ContentType="application/json", CacheControl="no-cache")
    print(f"Uploaded {len(changed):,}, deleted {len(removed):,}, kept {len(kept):,} the build didn't produce. Manifest has {len(manifest):,} files.")


def pull(args):
    base = os.environ.get("DATA_URL", "").rstrip("/")
    if not base:
        sys.exit("Set DATA_URL to the bucket's public URL.")
    def fetch(k):
        # A dropped connection now and then is normal over thousands of files: retry with a pause, then give up
        for i in range(5):
            try:
                return urllib.request.urlopen(urllib.request.Request(f"{base}/{PREFIX}{k}", headers={"User-Agent": "fpr-sync"}), timeout=60).read()
            except (OSError, urllib.error.URLError) as e:
                if i == 4:
                    raise SystemExit(f"Couldn't download {k} after 5 tries ({e}). Nothing is half-written; run the pull again.")
                time.sleep(2 * (i + 1))
    keys = list(json.loads(fetch("_manifest.json"))) if args.all else args.paths
    if not keys:
        sys.exit("Name files to pull, or use --all.")

    def get(k):
        dest = LOCAL / k
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(fetch(k))
        return k

    with ThreadPoolExecutor(8) as ex:
        for n, _ in enumerate(as_completed([ex.submit(get, k) for k in keys]), 1):
            _.result()
            if n % 500 == 0:
                print(f"  {n:,}/{len(keys):,}")
    print(f"Pulled {len(keys):,} files into public/data")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("push"); p.add_argument("--dry-run", action="store_true"); p.add_argument("--prune", action="store_true")
    q = sub.add_parser("pull"); q.add_argument("paths", nargs="*"); q.add_argument("--all", action="store_true")
    args = ap.parse_args()
    push(args) if args.cmd == "push" else pull(args)


if __name__ == "__main__":
    main()
