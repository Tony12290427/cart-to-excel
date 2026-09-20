#!/usr/bin/env python3
"""Generate a handwritten signature image with the Graves handwriting RNN.

This drives the checkpoint from sjvasquez/handwriting-synthesis (a 2018 TF1
model) through modern TensorFlow: the .meta file carries the full graph, so no
TF1 install and no porting is needed. The checkpoint ships in ``tools/model/``;
if those files are missing the script re-downloads them from upstream. Note that
upstream has no LICENSE file — see the licensing note in README.md.

    python3 -m venv .venv-neural
    .venv-neural/bin/pip install tensorflow pillow
    .venv-neural/bin/python tools/neural_signature.py "Tony Chan" -o signature.png

Then drop the PNG into the web page with the "Upload image" button.
"""
import argparse
import os
import sys
import urllib.request

BASE = 'https://raw.githubusercontent.com/sjvasquez/handwriting-synthesis/master'
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'model')
ASSETS = {
    'model-17900.meta': BASE + '/checkpoints/model-17900.meta',
    'model-17900.index': BASE + '/checkpoints/model-17900.index',
    'model-17900.data-00000-of-00001': BASE + '/checkpoints/model-17900.data-00000-of-00001',
}

ALPHABET = [
    '\x00', ' ', '!', '"', "'", '(', ')', ',', '-', '.', '0', '1', '2', '3',
    '4', '5', '6', '7', '8', '9', ':', ';', '?', 'A', 'B', 'C', 'D', 'E', 'F',
    'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'U', 'V',
    'W', 'Y', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
]
# The training alphabet has no uppercase Q, X or Z, so those fall back to lower case
ALPHA_TO_NUM = {c: i for i, c in enumerate(ALPHABET)}

CKPT = os.path.join(MODEL_DIR, 'model-17900')
MAX_CHARS = 120
MAX_STROKES = 1200


def ensure_assets():
    if not os.path.isdir(MODEL_DIR):
        os.makedirs(MODEL_DIR)
    for name, url in ASSETS.items():
        path = os.path.join(MODEL_DIR, name)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            continue          # the checkpoint is committed; this is a fallback
        sys.stderr.write('downloading %s ...\n' % name)
        urllib.request.urlretrieve(url, path)


def encode(text):
    return [ALPHA_TO_NUM.get(ch, ALPHA_TO_NUM.get(ch.lower(), 0)) for ch in text]


def sample(text, bias=0.75, steps=None, seed=None):
    """Run the RNN and return an array of (dx, dy, pen_up) offsets."""
    import numpy as np
    import tensorflow as tf

    tf.compat.v1.disable_eager_execution()
    ensure_assets()

    if steps is None:
        steps = 40 * max(len(text), 1)     # the upstream demo's heuristic
    chars = encode(text)

    # Placeholder names come from the meta graph; the order they were created in
    # calculate_loss() is x, y, x_len, c, c_len, sample_tsteps, num_samples,
    # prime, x_prime, x_prime_len (+ a PlaceholderWithDefault for the bias).
    c = np.zeros((1, MAX_CHARS), np.int32)
    c[0, :len(chars)] = chars
    c_len = np.array([len(chars)], np.int32)

    graph = tf.Graph()
    with graph.as_default():
        saver = tf.compat.v1.train.import_meta_graph(CKPT + '.meta')
        out = graph.get_tensor_by_name('cond/Merge:0')

    feed = {
        'Placeholder_3:0': c,
        'Placeholder_4:0': c_len,
        'Placeholder_5:0': steps,
        'Placeholder_6:0': 1,
        # prime=False: the style-primed branch of this graph cannot run under
        # modern TF (the untaken tf.cond branch dies with "TensorArray has size
        # zero"), and the styles/ folder no longer matches upstream demo.py.
        'Placeholder_7:0': False,
        'Placeholder_8:0': np.zeros((1, 2, 3), np.float32),
        'Placeholder_9:0': np.array([2], np.int32),
        'PlaceholderWithDefault:0': np.full([1], bias, np.float32),
    }
    if seed is not None:
        tf.compat.v1.set_random_seed(seed)
    with tf.compat.v1.Session(graph=graph) as sess:
        saver.restore(sess, CKPT)
        seq = sess.run(out, feed_dict=feed)[0]
    seq = seq[~np.all(seq == 0.0, axis=1)]
    return seq


def split_strokes(seq):
    """Group offsets into pen strokes, breaking wherever the pen lifted."""
    import numpy as np
    xy = np.cumsum(seq[:, :2], axis=0)
    strokes, current = [], [xy[0]]
    for i in range(1, len(xy)):
        if seq[i - 1, 2] > 0.5:
            if len(current) > 1:
                strokes.append(np.array(current))
            current = [xy[i]]
        else:
            current.append(xy[i])
    if len(current) > 1:
        strokes.append(np.array(current))
    return strokes


def smooth(strokes, passes=3):
    """Chaikin-style corner cutting — the raw samples are visibly polygonal."""
    import numpy as np
    out = []
    for s in strokes:
        pts = s
        for _ in range(passes):
            if len(pts) < 3:
                break
            new_pts = [pts[0]]
            for i in range(len(pts) - 1):
                p, q = pts[i], pts[i + 1]
                new_pts.append(0.75 * p + 0.25 * q)
                new_pts.append(0.25 * p + 0.75 * q)
            new_pts.append(pts[-1])
            pts = np.array(new_pts)
        out.append(pts)
    return out


def render(strokes, path, width=5, color=(17, 17, 17, 255), height=220, pad=24):
    """Draw the strokes into a transparent PNG, scaled to a fixed height."""
    import numpy as np
    from PIL import Image, ImageDraw

    pts = np.vstack(strokes)
    mn, mx = pts.min(0), pts.max(0)
    size = np.maximum(mx - mn, 1e-6)
    scale = height / size[1]
    canvas = Image.new('RGBA', (int(size[0] * scale + pad * 2), int(height + pad * 2)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    for s in strokes:
        line = [(pad + (x - mn[0]) * scale, pad + (y - mn[1]) * scale) for x, y in s]
        draw.line(line, fill=color, width=width, joint='curve')
        for x, y in (line[0], line[-1]):          # round caps
            draw.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=color)
    canvas.save(path)
    return canvas.size


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('text', help='text to write, e.g. "Tony Chan"')
    ap.add_argument('-o', '--out', default='signature.png')
    ap.add_argument('--bias', type=float, default=0.75, help='sampling bias (0.5-1.5); higher is tidier')
    ap.add_argument('--steps', type=int, default=None, help='sampling steps (default 40 per character)')
    ap.add_argument('--seed', type=int, default=None, help='fix the RNG for a repeatable signature')
    ap.add_argument('--width', type=int, default=5, help='pen width in pixels')
    args = ap.parse_args()

    seq = sample(args.text, bias=args.bias, steps=args.steps, seed=args.seed)
    strokes = smooth(split_strokes(seq))
    size = render(strokes, args.out, width=args.width)
    print('%s -> %s  (%d strokes, %dx%d)' % (args.text, args.out, len(strokes), size[0], size[1]))


if __name__ == '__main__':
    main()
