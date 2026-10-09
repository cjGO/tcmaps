"""Check map statistics against the CSV; run against a local Vite server."""
import csv
import math
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright

rows = list(csv.DictReader((Path(__file__).resolve().parents[1] / 'map_round_stats.csv').open()))
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173')

    def check(tab, low, high):
        name = page.locator(f'#{tab}-filename').inner_text().removeprefix('scn_').removesuffix('.png')
        selected = [row for row in rows if row['map_name'] == name and row['player_count'] and low <= float(row['player_count']) <= high]
        assert page.locator(f'#{tab}-game-count').inner_text() == str(len(selected))
        assert page.locator(f'#{tab}-round-rows tr').count() == len(selected)
        expected = f"{100 * sum(row['result'] == 'team1' for row in selected) / len(selected):.1f}%" if selected else '—'
        assert page.locator(f'#{tab}-team1-average').inner_text() == expected
        durations = [float(row['duration_seconds']) for row in selected if row['duration_seconds'] and float(row['duration_seconds']) >= 0]
        seconds = math.floor(sum(durations) / len(durations) + .5) if durations else None
        expected = f'{seconds // 60}m {seconds % 60}s' if seconds is not None else '—'
        assert page.locator(f'#{tab}-duration-average').inner_text() == expected

    check('rotation', 1, 30)
    page.locator('#rotation-player-min').fill('5')
    page.locator('#rotation-player-max').fill('15')
    check('rotation', 5, 15)
    filename = page.locator('#rotation-filename').inner_text()
    page.locator('#rotation-player-min').focus()
    page.keyboard.press('ArrowRight')
    assert page.locator('#rotation-filename').inner_text() == filename
    check('rotation', 6, 15)
    page.click('#rotation-next')
    check('rotation', 1, 30)
    page.click('#rotation-previous')
    check('rotation', 6, 15)
    page.click('#good-tab')
    check('good', 1, 30)
    page.locator('#good-player-max').fill('1')
    check('good', 1, 1)
    page.locator('#good-player-min').fill('20')
    assert page.locator('#good-player-min').input_value() == '1'
    page.locator('#good-player-max').fill('30')
    page.locator('#good-player-min').fill('30')
    check('good', 30, 30)
    page.locator('#good-player-min').focus()
    page.keyboard.press('ArrowLeft')
    check('good', 29, 30)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.locator('#good-round-stats').scroll_into_view_if_needed()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert not errors, errors
    browser.close()
print('Map statistics browser checks passed.')
