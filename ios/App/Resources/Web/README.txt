build_ui.sh puts the built Vue UI here as two files: index.html (same file as
the Android asset) and manifest.json (the H5 hot-update manifest written next to
it by the UI build: {"kind":"evcity-ac-h5","base":"<app version>","rev":0}; it
says which revision of the UI is built into the app). Both are generated and are
not committed. This file only keeps the folder in git; it is harmless inside the
app bundle.
