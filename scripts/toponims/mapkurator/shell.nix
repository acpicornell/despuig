# Python env for the mapKurator merge/assembly scripts (complex geometry → Python).
#
#   nix-shell scripts/toponims/mapkurator/shell.nix --run "python3 scripts/toponims/mapkurator/merge_detections.py"
#
{ pkgs ? import <nixpkgs> { } }:
pkgs.mkShell {
  packages = [
    (pkgs.python3.withPackages (ps: with ps; [
      shapely   # real polygon geometry + IoU for deduping overlapping detections
      numpy
      scipy     # cKDTree spatial index
      pillow    # image preview/grid + crop rendering
      unidecode # accent folding for cleanup/matching
    ]))
  ];
}
