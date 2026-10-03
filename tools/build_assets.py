#!/usr/bin/env python3
"""
B-29 asset builder.

Converts public-domain NASA / GEBCO / HYG source data into the compact textures
and binaries that the game streams at runtime.

Sources (download into RAW_DIR first, see README.md):
  bm_plain_07_21600.jpg      NASA Blue Marble NG (July 2004, no relief shading)
                             eoimages.gsfc.nasa.gov/.../74092/world.200407.3x21600x10800.jpg
  bm_topo_bathy_06_21600.jpg NASA Blue Marble NG w/ bathymetry (June 2004)
                             eoimages.gsfc.nasa.gov/.../73726/world.topo.bathy.200406.3x21600x10800.jpg
  gebco_elev.png             GEBCO_08 land elevation (21600x10800, 8 bit)
                             eoimages.gsfc.nasa.gov/.../73934/gebco_08_rev_elev_21600x10800.png
  blackmarble_gray.jpg       NASA Black Marble 2016 (3 km, gray)
                             eoimages.gsfc.nasa.gov/.../144897/BlackMarble_2016_3km_gray.jpg
  clouds_8192.tif            NASA cloud_combined_8192.tif
  moon_color_4k.tif          NASA SVS CGI Moon Kit (LROC color)
  moon_ldem_4.tif            NASA SVS CGI Moon Kit (LOLA elevation, km)
  hyg_v41.csv                HYG star database v4.1 (CC BY-SA 4.0, astronexus)

Usage: python3 tools/build_assets.py RAW_DIR public/assets
"""
import sys, os, struct, csv, math
import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None

RAW = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(os.path.join(OUT, 'earth'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'moon'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'sky'), exist_ok=True)


def raw(name):
    return os.path.join(RAW, name)


def out(*p):
    return os.path.join(OUT, *p)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def build_earth():
    print('earth: loading blue marble')
    plain = np.array(Image.open(raw('bm_plain_07_21600.jpg')))  # uint8 HxWx3
    bathy_g = np.array(Image.open(raw('bm_topo_bathy_06_21600.jpg')))[..., 1].copy()
    # Continental shelf indicator from the bathymetry mosaic, softened.
    small = Image.fromarray(bathy_g).resize((5400, 2700), Image.BOX)
    del bathy_g
    sh = smoothstep(50.0, 68.0, np.asarray(small).astype(np.float32))
    shelf_img = Image.fromarray((sh * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.0))
    shelf_img = shelf_img.resize((21600, 10800), Image.BILINEAR)
    shelf_all = np.asarray(shelf_img)
    del small, sh, shelf_img
    deep = np.array([3.0, 9.0, 27.0], np.float32)
    shelfc = np.array([7.0, 22.0, 40.0], np.float32)
    Hh = plain.shape[0]
    col = np.empty_like(plain)
    mask = np.empty(plain.shape[:2], np.uint8)
    step = 540
    for y0 in range(0, Hh, step):
        p = plain[y0:y0 + step].astype(np.int16)
        R, G, B = p[..., 0], p[..., 1], p[..., 2]
        # Water: the plain mosaic paints the open ocean (2,5,20) and lakes near-black.
        water = (np.maximum(np.maximum(R, G), B) < 26) & (R < 8)
        s = shelf_all[y0:y0 + step].astype(np.float32)[..., None] / 255.0
        ocean = deep[None, None, :] * (1 - s) + shelfc[None, None, :] * s
        c = np.where(water[..., None], ocean, p.astype(np.float32))
        col[y0:y0 + step] = np.clip(c, 0, 255).astype(np.uint8)
        mask[y0:y0 + step] = water.astype(np.uint8) * 255
    del plain, shelf_all
    img = Image.fromarray(col, 'RGB')
    mimg = Image.fromarray(mask, 'L')
    for size, name in [((4096, 2048), 'color_4k.webp')]:
        print('earth: writing', name)
        c = img.resize(size, Image.LANCZOS)
        m = mimg.resize(size, Image.BOX)
        c.putalpha(m)
        c.save(out('earth', name), 'WEBP', quality=90, method=6, alpha_quality=100, exact=True)
    mimg.resize((4096, 2048), Image.BOX).save(out('earth', 'water_4k.png'), optimize=True)
    del img, mimg, col, mask

    print('earth: elevation')
    g = Image.open(raw('gebco_elev.png'))
    gf = np.asarray(g).astype(np.float32)
    # GEBCO_08 rendition: ~25.5 m per step, clipped at 255.
    hm = gf * 25.5
    himg = Image.fromarray(hm.astype(np.float32), 'F').resize((4096, 2048), Image.BOX)
    h = np.asarray(himg)
    e = np.sqrt(np.clip(h / 6600.0, 0, 1)) * 255.0
    Image.fromarray(np.clip(np.round(e), 0, 255).astype(np.uint8), 'L').save(out('earth', 'elev_4k.png'), optimize=True)
    del g, gf, hm, himg

    print('earth: night lights')
    l = Image.open(raw('blackmarble_gray.jpg')).convert('L').resize((4096, 2048), Image.LANCZOS)
    la = np.asarray(l).astype(np.float32) / 255.0
    # remove the faint land/ocean background, keep the city lights
    la = np.clip((la - 0.10) / 0.90, 0, 1) ** 1.25
    Image.fromarray((la * 255).astype(np.uint8), 'L').save(out('earth', 'lights_4k.jpg'), quality=90)

    print('earth: clouds')
    c = Image.open(raw('clouds_8192.tif')).convert('L')
    c.resize((4096, 2048), Image.LANCZOS).save(out('earth', 'clouds_4k.jpg'), quality=90)


def build_moon():
    print('moon: color')
    c = Image.open(raw('moon_color_4k.tif')).convert('RGB')
    c.resize((2048, 1024), Image.LANCZOS).save(out('moon', 'color_2k.jpg'), quality=90)
    print('moon: normals')
    d = np.array(Image.open(raw('moon_ldem_4.tif'))).astype(np.float64)  # km
    di = Image.fromarray(d.astype(np.float32), 'F').resize((2048, 1024), Image.BICUBIC)
    h = np.asarray(di).astype(np.float64) * 1000.0  # m
    Hh, Ww = h.shape
    Rm = 1737400.0
    lat = (0.5 - (np.arange(Hh) + 0.5) / Hh) * math.pi
    dlam = 2 * math.pi / Ww
    dphi = math.pi / Hh
    hx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * dlam * Rm * np.maximum(np.cos(lat)[:, None], 0.05))
    hy = np.zeros_like(h)
    hy[1:-1] = (h[:-2] - h[2:]) / (2 * dphi * Rm)
    ex = 3.0
    nx, ny, nz = -hx * ex, -hy * ex, np.ones_like(h)
    n = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / n, ny / n, nz / n], -1) * 0.5 + 0.5
    Image.fromarray((rgb * 255).astype(np.uint8), 'RGB').save(out('moon', 'normal_2k.jpg'), quality=92)


def build_stars():
    print('stars')
    rows = []
    with open(raw('hyg_v41.csv'), newline='') as f:
        r = csv.DictReader(f)
        for s in r:
            try:
                mag = float(s['mag'])
            except ValueError:
                continue
            if s['proper'] == 'Sol' or mag > 7.6:
                continue
            ra = float(s['rarad'])
            dec = float(s['decrad'])
            try:
                ci = float(s['ci']) if s['ci'] else 0.6
            except ValueError:
                ci = 0.6
            # ECI (X = vernal equinox, Z = north) -> engine frame (Y up, Z = -Y_eci)
            x = math.cos(dec) * math.cos(ra)
            y = math.sin(dec)
            z = -math.cos(dec) * math.sin(ra)
            rows.append((x, y, z, mag, ci))
    rows.sort(key=lambda t: t[3])
    print('  stars kept', len(rows))
    with open(out('sky', 'stars.bin'), 'wb') as f:
        for t in rows:
            f.write(struct.pack('<5f', *t))


if __name__ == '__main__':
    which = sys.argv[3:] or ['earth', 'moon', 'stars']
    if 'earth' in which:
        build_earth()
    if 'moon' in which:
        build_moon()
    if 'stars' in which:
        build_stars()
    print('done')


# ---------------------------------------------------------------------------
# High-resolution tiles (8 x 4 tiles of 45 deg, 2700 px + 8 px padding), streamed near the ship.
TILE = 2700
PAD = 8
LT = 1350
LPAD = 4


def build_tiles():
    os.makedirs(out('earth', 'tiles'), exist_ok=True)
    print('tiles: loading')
    plain = np.array(Image.open(raw('bm_plain_07_21600.jpg')))
    bathy_g = np.array(Image.open(raw('bm_topo_bathy_06_21600.jpg')))[..., 1].copy()
    small = Image.fromarray(bathy_g).resize((5400, 2700), Image.BOX)
    del bathy_g
    sh = smoothstep(50.0, 68.0, np.asarray(small).astype(np.float32))
    shelf_all = np.asarray(Image.fromarray((sh * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.0)).resize((21600, 10800), Image.BILINEAR))
    deep = np.array([3.0, 9.0, 27.0], np.float32)
    shelfc = np.array([7.0, 22.0, 40.0], np.float32)
    lights = Image.open(raw('blackmarble_gray.jpg')).convert('L').resize((10800, 5400), Image.LANCZOS)
    la = np.asarray(lights).astype(np.float32) / 255.0
    la = (np.clip((la - 0.10) / 0.90, 0, 1) ** 1.25 * 255).astype(np.uint8)
    H, W = plain.shape[:2]
    for row in range(4):
        for col in range(8):
            y0, x0 = row * TILE, col * TILE
            ys = np.clip(np.arange(y0 - PAD, y0 + TILE + PAD), 0, H - 1)
            xs = np.arange(x0 - PAD, x0 + TILE + PAD) % W
            p = plain[np.ix_(ys, xs)].astype(np.int16)
            R, G, B = p[..., 0], p[..., 1], p[..., 2]
            water = (np.maximum(np.maximum(R, G), B) < 26) & (R < 8)
            s = shelf_all[np.ix_(ys, xs)].astype(np.float32)[..., None] / 255.0
            ocean = deep[None, None, :] * (1 - s) + shelfc[None, None, :] * s
            c = np.where(water[..., None], ocean, p.astype(np.float32))
            img = Image.fromarray(np.clip(c, 0, 255).astype(np.uint8), 'RGB')
            img.putalpha(Image.fromarray(water.astype(np.uint8) * 255, 'L'))
            img.save(out('earth', 'tiles', f'c_{col}_{row}.webp'), 'WEBP', quality=86, method=6, alpha_quality=100, exact=True)
            ly0, lx0 = row * LT, col * LT
            lys = np.clip(np.arange(ly0 - LPAD, ly0 + LT + LPAD), 0, la.shape[0] - 1)
            lxs = np.arange(lx0 - LPAD, lx0 + LT + LPAD) % la.shape[1]
            Image.fromarray(la[np.ix_(lys, lxs)], 'L').save(out('earth', 'tiles', f'l_{col}_{row}.jpg'), quality=88)
            print('  tile', col, row)


if __name__ == '__main__' and 'tiles' in sys.argv[3:]:
    build_tiles()
