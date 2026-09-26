"""Calibrate the existing renderer at its actual export DPI."""
import base64
import json
from unittest.mock import patch

from helpers import EDITOR_ROOT, render_png


def calibrated_heatmap(data, destination, placements=()):
    from matplotlib.figure import Figure
    original_save = Figure.savefig
    calibration = {}

    def save(fig, *args, **kwargs):
        ax = fig.axes[0]
        for i, point in enumerate(placements, 1):
            ax.plot(point['x_m'], point['y_m'], marker='o', color='#d9480f',
                    markeredgecolor='white', markersize=6, zorder=20)
            ax.annotate(str(i), (point['x_m'], point['y_m']), xytext=(5, 5),
                        textcoords='offset points', fontsize=7, zorder=21)

        def capture(event):
            box = ax.get_window_extent(event.renderer)
            width, height = fig.bbox.width, fig.bbox.height
            calibration.update(width_px=round(width), height_px=round(height),
                               plot_rect=dict(left=box.x0/width, top=1-box.y1/height,
                                              width=box.width/width, height=box.height/height),
                               x_limits=list(ax.get_xlim()), y_limits=list(ax.get_ylim()))
        connection = fig.canvas.mpl_connect('draw_event', capture)
        try:
            return original_save(fig, *args, **kwargs)
        finally:
            fig.canvas.mpl_disconnect(connection)

    # Scoped to this synchronous CLI render; no changes to the shared helper.
    with patch.object(Figure, 'savefig', save):
        render_png(data, destination)
    if not calibration or min(calibration['plot_rect']['width'], calibration['plot_rect']['height']) <= 0:
        raise ValueError('Could not calibrate exported heatmap')
    return calibration


def editor_html(project, image_path):
    payload = json.dumps(project, allow_nan=False, separators=(',', ':')).replace('<', '\\u003c')
    root = EDITOR_ROOT / 'web'
    template = (root / 'index.html').read_text(encoding='utf-8')
    image = base64.b64encode(image_path.read_bytes()).decode('ascii')
    return (template.replace('/* EDITOR_STYLE */', (root / 'style.css').read_text(encoding='utf-8'))
            .replace('/* EDITOR_CORE */', (root / 'coordinates.js').read_text(encoding='utf-8'))
            .replace('/* EDITOR_APP */', (root / 'app.js').read_text(encoding='utf-8'))
            .replace('__EDITOR_DATA__', payload).replace('__HEATMAP__', image))
