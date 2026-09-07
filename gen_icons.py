import zlib, struct

def chunk(typ, data):
    c = struct.pack('>I', len(data)) + typ + data
    c += struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    return c

def write_png(filepath, size, rows):
    raw = b''
    for y in range(size):
        raw += b'\x00'
        for x in range(size):
            raw += bytes(rows[y][x])
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(filepath, 'wb') as f:
        f.write(png)

def in_rounded_square(px, py, size, corner_radius):
    if corner_radius <= 0:
        return True
    if px < 0 or py < 0 or px > size or py > size:
        return False
    inner = size - corner_radius
    if corner_radius <= px <= inner or corner_radius <= py <= inner:
        return True
    def corner(cx, cy):
        return (px - cx) ** 2 + (py - cy) ** 2 <= corner_radius ** 2
    if px < corner_radius and py < corner_radius:
        return corner(corner_radius, corner_radius)
    if px > inner and py < corner_radius:
        return corner(inner, corner_radius)
    if px < corner_radius and py > inner:
        return corner(corner_radius, inner)
    if px > inner and py > inner:
        return corner(inner, inner)
    return False

def make_icon(size, content_scale=1.0, rounded=False):
    s = size / 100.0
    green = (46, 204, 113, 255)
    white = (255, 255, 255, 255)
    transparent = (0, 0, 0, 0)
    cx, cy = 50 * s, 50 * s
    r = 38 * s * content_scale
    corner_radius = 0.22 * size if rounded else 0

    def scaled(p):
        return 50 * s + (p - 50 * s) * content_scale

    def in_circle(x, y):
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

    def tri_contains(x, y):
        x0, y0 = scaled(41 * s), scaled(34 * s)
        x1, y1 = scaled(41 * s), scaled(66 * s)
        x2, y2 = scaled(66 * s), scaled(50 * s)
        d1 = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0)
        d2 = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)
        d3 = (x0 - x2) * (y - y2) - (y0 - y2) * (x - x2)
        has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
        has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
        return not (has_neg and has_pos)

    rows = []
    for yy in range(size):
        row = []
        for xx in range(size):
            px, py = xx + 0.5, yy + 0.5
            if rounded and not in_rounded_square(px, py, size, corner_radius):
                row.append(transparent)
            elif in_circle(px, py):
                if tri_contains(px, py):
                    row.append(green)
                else:
                    row.append(white)
            else:
                row.append(green)
        rows.append(row)
    return rows

for size in (192, 512):
    write_png(f'icon-{size}.png', size, make_icon(size, rounded=True))
    print(f'icon-{size}.png generado (any, esquinas redondeadas)')
    write_png(f'icon-{size}-maskable.png', size, make_icon(size, content_scale=0.6, rounded=False))
    print(f'icon-{size}-maskable.png generado (maskable, full-bleed)')