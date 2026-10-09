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
    check('rotation', 6, 15)
    page.click('#rotation-previous')
    check('rotation', 6, 15)
    # Compare the actual navigation order with independent CSV calculations.
    rotation_files = sorted(path.name for path in (Path(__file__).resolve().parents[1] / 'current_rotation').glob('*.png'))
    def expected_order(metric, direction, low, high):
        def key(filename):
            map_name = filename.removeprefix('scn_').removesuffix('.png')
            matching = [row for row in rows if row['map_name'] == map_name and row['player_count'] and low <= float(row['player_count']) <= high]
            number = int(map_name.rsplit('_', 1)[1])
            if metric == 'number':
                return (0, number if direction == 'asc' else -number, number)
            value = None
            if metric == 'games':
                value = len(matching)
            elif metric == 'win' and matching:
                value = sum(row['result'] == 'team1' for row in matching) / len(matching)
            elif metric == 'duration':
                durations = [float(row['duration_seconds']) for row in matching if row['duration_seconds'] and float(row['duration_seconds']) >= 0]
                if durations:
                    value = sum(durations) / len(durations)
            return (value is None, 0 if value is None else value * (1 if direction == 'asc' else -1), number)
        return sorted(rotation_files, key=key)

    for metric in ['games', 'duration', 'win', 'number']:
        for direction in ['asc', 'desc']:
            page.select_option('#rotation-sort', metric)
            page.select_option('#rotation-sort-direction', direction)
            actual = page.evaluate("""() => {
                const result = [];
                const count = Number(document.querySelector('#rotation-count').textContent.split('/')[1]);
                for (let i = 0; i < count; i++) {
                    result.push(document.querySelector('#rotation-filename').textContent);
                    document.querySelector('#rotation-next').click();
                }
                return result;
            }""")
            assert actual == expected_order(metric, direction, 6, 15), (metric, direction)
            check('rotation', 6, 15)
    page.select_option('#rotation-sort', 'games')
    selected = page.locator('#rotation-filename').inner_text()
    page.locator('#rotation-player-max').fill('30')
    page.locator('#rotation-player-min').fill('30')
    assert page.locator('#rotation-filename').inner_text() == selected
    check('rotation', 30, 30)
    page.select_option('#rotation-sort-direction', 'asc')
    assert page.locator('#rotation-filename').inner_text() == expected_order('games', 'asc', 30, 30)[0]
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
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
