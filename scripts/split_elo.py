"""
split_elo.py — the site's two player files, written from public/data/elo.json.

  public/data/players.json   every player without elo_history (the site loads this first, ~2 MB)
  public/data/history.json   every player's game-by-game Elo, packed (loaded in the background)
     {"epoch": "1946-01-01", "codes": [team codes], "h": [[...], ...]}   h[i] belongs to players[i]
     each game is 4 numbers: days since the previous game (since the epoch for the first),
     Elo × 10, opponent code index, team code index × 2 + 1 if a playoff game

elo.json stays as the pipeline's full record (fetch_espn.py and update_elo.py read it).
Run after build_elo.py:  python3 scripts/split_elo.py
"""
import datetime as dt, json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "public" / "data"
EPOCH = dt.date(1946, 1, 1)


def main():
    d = json.loads((DATA / "elo.json").read_text(encoding="utf-8"))
    codes, index = [], {}
    def ci(c):
        if c not in index:
            index[c] = len(codes); codes.append(c)
        return index[c]
    packed = []
    for p in d["players"]:
        out, prev = [], 0
        for date, elo, opp, post, team in p.get("elo_history") or []:
            day = (dt.date.fromisoformat(date) - EPOCH).days
            out += [day - prev, round(elo * 10), ci(opp), ci(team) * 2 + (1 if post else 0)]
            prev = day
        packed.append(out)
    summary = {k: v for k, v in d.items() if k != "players"}
    summary["players"] = [{k: v for k, v in p.items() if k != "elo_history"} for p in d["players"]]
    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    (DATA / "players.json").write_text(dump(summary), encoding="utf-8")
    (DATA / "history.json").write_text(dump({"epoch": EPOCH.isoformat(), "codes": codes, "h": packed}), encoding="utf-8")
    print(f"  players.json {len(dump(summary)) / 1e6:.1f} MB, history.json {(DATA / 'history.json').stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
