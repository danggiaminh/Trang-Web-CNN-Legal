# Dựng lại subset latin của Raleway mà site dùng. Khác bản Google Fonts/Fontsource đúng
# một điểm: ký tự W và w trỏ sang glyph ss09, hai nét giữa không bắt chéo nhau. Subset
# của Google cắt mất ss09 nên CSS font-feature-settings không bật được.
# OFL cấm bản đã sửa mang Reserved Font Name "Raleway" (xem OFL.txt) nên đổi tên nội bộ.
#
# Chạy ở gốc repo:
#   curl -L -o /tmp/Raleway.ttf https://raw.githubusercontent.com/google/fonts/e16e28b2a73398cbc960f5306f961c1276cc29fc/ofl/raleway/Raleway%5Bwght%5D.ttf
#   uv run --with fonttools --with brotli python3 src/assets/fonts/build-latin.py /tmp/Raleway.ttf
import hashlib
import sys

from fontTools import subset
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont

SRC = sys.argv[1]
SRC_SHA256 = "8bbcc3eb8275c388f4bcd998832f8a4b943eadbaf6a595205312774b5951aefb"
# Subset latin của Google Fonts (Fontsource chép y nguyên): lấy tập ký tự và để đối chiếu.
REF = "node_modules/@fontsource-variable/raleway/files/raleway-latin-wght-normal.woff2"
OUT = "src/assets/fonts/raleway-latin-wght-ss09.woff2"
SWAP = {0x57: "W.ss09", 0x77: "w.ss09"}

with open(SRC, "rb") as fh:
    assert hashlib.sha256(fh.read()).hexdigest() == SRC_SHA256, "nguồn không phải Raleway 4.026 đã ghim"
ref = TTFont(REF)
font = TTFont(SRC, recalcTimestamp=False)  # giữ head.modified của bản gốc để dựng lại ra đúng từng byte

for sub in font["cmap"].tables:
    for cp, glyph in SWAP.items():
        if cp in getattr(sub, "cmap", {}):
            sub.cmap[cp] = glyph

opts = subset.Options()
opts.flavor = "woff2"
opts.layout_features = ["ccmp", "dnom", "frac", "liga", "lnum", "locl", "numr", "kern", "mark", "mkmk"]
opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, *range(256, 277)]
opts.notdef_outline = True
subsetter = subset.Subsetter(opts)
subsetter.populate(unicodes=ref.getBestCmap())
subsetter.subset(font)

for rec in font["name"].names:
    if rec.nameID != 0:  # dòng bản quyền giữ nguyên
        rec.string = (
            rec.toUnicode()
            .replace("RalewayRoman", "CNNLegalSans")
            .replace("Raleway-", "CNNLegalSans-")
            .replace("Raleway", "CNN Legal Sans")
        )
subset.save_font(font, OUT, opts)

# Tự kiểm: W/w phải là nét ss09 của bản gốc, mọi glyph khác trùng bản Google ở nét chữ
# (4 độ đậm), độ rộng và hinting; tập ký tự, các bảng và feature cũng phải trùng.
# So bằng nét chữ chứ không bằng tên: file xuất ra không giữ tên glyph.
out, src = TTFont(OUT), TTFont(SRC)
cmap, rcmap = out.getBestCmap(), ref.getBestCmap()
assert cmap.keys() == rcmap.keys()
assert sorted(out.keys()) == sorted(ref.keys()) and len(out.getGlyphOrder()) == len(ref.getGlyphOrder())
pairs = [(".notdef", ref, ".notdef")] + [
    (cmap[cp], src, SWAP[cp]) if cp in SWAP else (cmap[cp], ref, rcmap[cp]) for cp in sorted(cmap)
]


def shape(gs, g):
    pen = DecomposingRecordingPen(gs)
    gs[g].draw(pen)
    return pen.value, gs[g].width


for wght in (100, 400, 600, 900):
    sets = {id(f): f.getGlyphSet(location={"wght": wght}) for f in (out, ref, src)}
    for g, f, want in pairs:
        assert shape(sets[id(out)], g) == shape(sets[id(f)], want), (want, wght)
code = lambda f, g: f["glyf"][g].program.getBytecode() if hasattr(f["glyf"][g], "program") else b""
assert all(code(out, g) == code(f, want) for g, f, want in pairs)
tags = lambda f, t: sorted({r.FeatureTag for r in f[t].table.FeatureList.FeatureRecord})
assert all(tags(out, t) == tags(ref, t) for t in ("GSUB", "GPOS"))
assert not any("Raleway" in n.toUnicode() for n in out["name"].names if n.nameID != 0)
print(f"OK {OUT}: W/w -> ss09, {len(pairs) - 2} glyph khác trùng bản Google")
