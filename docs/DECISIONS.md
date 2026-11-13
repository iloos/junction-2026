# DECISIONS

`D#` · choice · why · what would reopen it. Append only.

### D0 · SvelteKit 2.70 + Svelte 5, not Kit 3.x — 13 Nov
Kit 3 is six weeks old; Kit 2 is proven in our own repos. Reopen if: the scaffold tool forces Kit 3 and it just works.

### D0b · IndexedDB (Dexie) for datasets, localStorage for prefs, both behind StoragePort — 13 Nov
"Lots of data points" exceeds localStorage's ~5 MB; no server DB keeps the overhead low. Reopen if: the challenge needs shared state across users (then use a tiny SQLite/Turso store behind the same port).

### D0c · d3 for maths and 2D, one optional 3D hero view behind a 1h spike — 13 Nov
3D impresses but costs readability and time. Reopen if: the spike shows 50k nodes smooth and the 3D reveals structure 2D can't.
