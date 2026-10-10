#!/usr/bin/env bash
# Generates a short technical test video for BOOL AI: 1080x1920 (9:16) MP4, 12s, silent audio track, dark background.
# Usage: bash tools/make_test_video.sh [output.mp4]     (needs ffmpeg with drawtext)
set -euo pipefail
OUT="${1:-test_bool_ai.mp4}"
FONT="${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}"   # contains Hebrew glyphs
[ -f "$FONT" ] || { echo "Font not found: $FONT (set FONT=/path/to/font.ttf)"; exit 1; }

HEB="BOOL AI – הניהול העסקי שלך במקום אחד"   # ffmpeg (fribidi) handles right-to-left text itself
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
printf '%s' "BOOL AI" > "$TMP/t1.txt"
printf '%s' "$HEB" > "$TMP/t2.txt"

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "color=c=0x12101c:s=1080x1920:r=30:d=12" \
  -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" \
  -vf "drawtext=fontfile=$FONT:textfile=$TMP/t1.txt:fontsize=220:fontcolor=0xd4b56a:x=(w-text_w)/2:y=780:alpha='min(1,t/1.2)', \
       drawtext=fontfile=$FONT:textfile=$TMP/t2.txt:fontsize=46:fontcolor=white:x=(w-text_w)/2:y=1060:alpha='min(1,max(0,(t-1)/1.2))'" \
  -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -c:a aac -b:a 64k -shortest -movflags +faststart \
  "$OUT"

echo "Created $OUT ($(du -h "$OUT" | cut -f1))"
