import zlib, struct

def write_png(filepath, size, rows):
    raw = b''
    for y in range(size):
        raw += b'\x00' + bytes(rows[y])
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(filepath, 'wb') as f:
        f.write(png)

def chunk(typ, data):
    c = struct.pack('>I', len(data)) + typ + data
    c += struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    return c

def make_icon(size):
    s = size / 100.0
    green = (46, 204, 113)
    white = (255, 255, 255)
    cx, cy, r = 50 * s, 50 * s, 38 * s

    def in_circle(x, y):
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

    def tri_contains(x, y):
        x0, y0 = 41 * s, 34 * s
        x1, y1 = 41 * s, 66 * s
        x2, y2 = 66 * s, 50 * s
        d1 = (x1 - x2) * (y - y2) - (y1 - y2) * (x - x2)
        d2 = (x0 - x2) * (y - y2) - (y0 - y2) * (x - x2)
        d3 = (x2 - x0) * (y - y0) - (y2 - y0) * (x - x0)
        has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
        has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
        return not (has_neg and has_pos)

    rows = []
    for yy in range(size):
        row = []
        for xx in range(size):
            if in_circle(xx + 0.5, yy + 0.5):
                if tri_contains(xx + 0.5, yy + 0.5):
                    row.extend(green)
                else:
                    row.extend(white)
            else:
                row.extend(green)
        rows.append(row)
    return rows

for size in (192, 512):
    write_png(f'icon-{size}.png', size, make_icon(size))
    print(f'icon-{size}.png generado')
