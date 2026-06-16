# Python environment for the NGIB toponym matching (fuzzy + geospatial analysis).
#
#   nix-shell scripts/toponims/shell.nix --run "python3 scripts/toponims/ngib_match.py"
#
{ pkgs ? import <nixpkgs> { } }:
pkgs.mkShell {
  packages = [
    (pkgs.python3.withPackages (ps: with ps; [
      rapidfuzz # fast fuzzy string matching (token_set_ratio, WRatio)
      jellyfish # phonetic similarity (metaphone, jaro-winkler) for old spellings
      scipy # thin-plate-spline georeference + cKDTree nearest neighbour
      numpy
      scikit-learn
      unidecode
    ]))
  ];
}
