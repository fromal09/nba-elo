"""Write public/data/top100.json: top 100 FPR-eligible players by current Elo."""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
d = json.loads((ROOT / "public/data/elo.json").read_text())

eligible = sorted((p for p in d["players"] if p.get("is_fpr_eligible")),
                  key=lambda p: -p["current_elo"])

top = [{
    "rank": i + 1,
    "name": p["name"],
    "team": p["team"],
    "elo": round(p["current_elo"], 1),
    "peak": round(p["peak_elo"], 1),
    "peak_rank": p.get("peak_fpr_rank"),
    "gp": p["games_played"],
    "gmsc": p.get("recent_gmsc_avg"),
    "last": p["last_played"],
} for i, p in enumerate(eligible[:100])]

out = {"generated": d["generated"], "eligible": len(eligible), "players": top}
(ROOT / "public/data/top100.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
print(f"top100.json: {len(top)} players, #1 {top[0]['name']} {top[0]['elo']}, #100 {top[-1]['elo']}")
