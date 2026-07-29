# Destination photos

Manually-sourced photos for `data/db.json` destinations. Not every
destination needs one — entries without a matching file just show a "no
photo yet" placeholder in the UI.

**Convention**: filename is a kebab-case slug of the place name (e.g.
`seven-hills.jpg`), and the destination's `image` field in `data/db.json`
points at `/assets/images/<file>`.

## Currently expected

| File                            | Destination                     |
|-----------------------------------|-----------------------------------|
| `seven-hills.jpg`                 | Seven Hills (`dest-001`)          |
| `playce-yaounde.jpg`               | PlaYce Yaounde (`dest-010`)       |
| `reunification-monument.jpg`       | Cameroon Reunification Monument (`dest-014`) |
| `hilton-yaounde.jpg`               | Hilton Yaounde (`dest-019`)       |

To add a photo for another destination, drop a file named after it here and
add `"image": "/assets/images/<file>"` to that entry in `data/db.json`.
