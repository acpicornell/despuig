#!/usr/bin/env python3
"""Remap per-sheet hand-curation (picks / graf-fixes / reviewed) from the ids of a
PRE-REBUILD toponym table onto the ids of a freshly rebuilt one.

The rebuild re-cuts windows, so ids change (B02_11 -> B07_3, etc). But each toponym's
position is the centroid of the SAME underlying spotter boxes, so a surviving name
keeps (almost) the same x,y and the same engraving grafia. We match old->new by
nearest (x,y), requiring the grafia key to agree among close candidates.

    OLD=.../no/prebuild-backup NEW=.../no python3 remap_curation.py [--apply]

Without --apply: dry-run report only. With --apply: rewrite NEW/{recheck-picks,
graf-fixes,review-reviewed}.json in place (a .bak is kept).
"""
import json, os, re, sys, math

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OLD = os.environ.get("OLD") or os.path.join(ROOT, "data/toponims/mapkurator/no/prebuild-backup")
NEW = os.environ.get("NEW") or os.path.join(ROOT, "data/toponims/no")
NEW_TOP = os.environ.get("NEW_TOP") or os.path.join(ROOT, "data/toponims/no/toponims.json")
KEY_RADIUS = float(os.environ.get("REMAP_KEY_RADIUS", "400"))  # px: same-grafia match allowed to drift this far (deskew/regroup)
POS_RADIUS = float(os.environ.get("REMAP_POS_RADIUS", "80"))   # px: blind nearest fallback only this close
APPLY = "--apply" in sys.argv


def deacc(s):
    for a, b in (("ô", "o"), ("â", "a"), ("î", "i"), ("ê", "e"), ("û", "u")):
        s = s.replace(a, b)
    return s


def key(s):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", deacc((s or "").lower()))).strip()


def load(path):
    return json.load(open(path)) if os.path.exists(path) else {}


def main():
    old_top = {t["id"]: t for t in json.load(open(os.path.join(OLD, "toponims.json")))["toponims"]}
    new_top = json.load(open(NEW_TOP))["toponims"]

    picks = load(os.path.join(OLD, "recheck-picks.json"))
    grafs = load(os.path.join(OLD, "graf-fixes.json"))
    reviewed = load(os.path.join(OLD, "review-reviewed.json"))
    curated_ids = set(picks) | set(grafs) | set(reviewed)

    # Match each curated old id to a new toponym. Strategy, in order:
    #   1. KEY match: any new toponym whose grafia key equals one of the old id's
    #      readings (human-corrected graf-fix / pick, else the backup engraving graf),
    #      taking the NEAREST such within KEY_RADIUS. Handles coastal items the deskew
    #      regrouped + repositioned, and truncated old reads now read in full.
    #   2. POS fallback: blind nearest within the tight POS_RADIUS (catches same place
    #      whose reading changed slightly, e.g. 'Sô Jua' -> 'Sô Juan').
    #   3. else UNMAPPED (the name is genuinely absent from the rebuild).
    # first pass: best candidate per old id, tagged with tier (0=key, 1=pos) + distance
    cand, unmapped, fuzzy = {}, [], []
    for oid in sorted(curated_ids):
        ot = old_top.get(oid)
        if not ot:
            unmapped.append((oid, "old id not in backup toponims")); continue
        ox, oy = ot["x"], ot["y"]
        # all readings we know for this old id -> candidate keys (human reads first)
        reads = [v for v in (grafs.get(oid), picks.get(oid), ot.get("graf")) if v]
        okeys = {key(r) for r in reads if key(r)}
        keyc = sorted(((math.hypot(nt["x"] - ox, nt["y"] - oy), nt) for nt in new_top
                       if key(nt["graf"]) in okeys), key=lambda c: c[0])
        if keyc and keyc[0][0] <= KEY_RADIUS:
            cand[oid] = (0, keyc[0][0], keyc[0][1]["id"], keyc[0][1]["graf"], reads[:1])
            continue
        posc = sorted(((math.hypot(nt["x"] - ox, nt["y"] - oy), nt) for nt in new_top),
                      key=lambda c: c[0])
        if posc and posc[0][0] <= POS_RADIUS:
            cand[oid] = (1, posc[0][0], posc[0][1]["id"], posc[0][1]["graf"], reads[:1])
            continue
        unmapped.append((oid, f"no key/pos match; ({ox},{oy}) reads={reads}"))

    # resolve collisions: if several old ids claim one new id, keep the best
    # (key-tier beats pos-tier, then nearest); the rest are dropped as unmapped.
    by_new = {}
    for oid, c in cand.items():
        by_new.setdefault(c[2], []).append(oid)
    mapping = {}
    for nid, oids in by_new.items():
        winner = min(oids, key=lambda o: (cand[o][0], cand[o][1]))
        mapping[winner] = nid
        if cand[winner][0] == 1:
            t = cand[winner]
            fuzzy.append((winner, "/".join(t[4]), nid, t[3], round(t[1], 1)))
        for o in oids:
            if o != winner:
                w = cand[o]
                unmapped.append((o, f"collision on {nid} (lost to {winner}); reads={w[4]}"))

    def remap(d):
        out, lost = {}, []
        for k, v in d.items():
            if k in mapping:
                out[mapping[k]] = v
            else:
                lost.append(k)
        return out, lost

    new_picks, lp = remap(picks)
    new_grafs, lg = remap(grafs)
    new_reviewed, lr = remap(reviewed)

    print(f"curated old ids: {len(curated_ids)}  mapped: {len(mapping)}  unmapped: {len(unmapped)}")
    print(f"  picks {len(picks)}->{len(new_picks)} (lost {len(lp)})  "
          f"grafs {len(grafs)}->{len(new_grafs)} (lost {len(lg)})  "
          f"reviewed {len(reviewed)}->{len(new_reviewed)} (lost {len(lr)})")
    if fuzzy:
        print(f"\n-- {len(fuzzy)} fuzzy matches (no grafia-key agreement, blind nearest <= {POS_RADIUS}px):")
        for oid, og, nid, ng, d in fuzzy:
            print(f"   {oid} {og!r}  ->  {nid} {ng!r}  ({d}px)")
    if unmapped:
        print(f"\n-- {len(unmapped)} UNMAPPED (curation dropped):")
        for oid, why in unmapped:
            print(f"   {oid}: {why}")

    if APPLY:
        for name, data in (("recheck-picks.json", new_picks),
                           ("graf-fixes.json", new_grafs),
                           ("review-reviewed.json", new_reviewed)):
            p = os.path.join(NEW, name)
            if os.path.exists(p):
                os.replace(p, p + ".bak")
            json.dump(data, open(p, "w"), ensure_ascii=False, indent=1)
            print(f"✓ wrote {p}")
    else:
        print("\n(dry-run; pass --apply to rewrite NEW curation files)")


if __name__ == "__main__":
    main()
