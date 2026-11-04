"""Real-data integration checks. Run against Vite with: uv run --with playwright python tests/player_stats_smoke.py [URL]."""
import json
import os
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
snapshot = json.loads((root / 'stats/snapshots/current.json').read_text())
players = list(snapshot['players'].values())
qualified = [p for p in players if p['totals']['rounds'] >= 20]
base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173'
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'))
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(base + '/?tab=playerstats', wait_until='domcontentloaded', timeout=120000)
    page.locator('#ps-summary').wait_for(timeout=120000)
    assert page.locator('#playerstats-tab').get_attribute('aria-selected') == 'true'
    assert page.locator('#ps-summary .ps-stat strong').nth(0).inner_text() == str(len(qualified))
    expected = sum(p['totals']['personal_kills'] + p['totals']['squad_kills'] for p in qualified)
    assert page.locator('#ps-summary .ps-stat strong').nth(1).inner_text() == f'{expected:,}'
    assert page.locator('#ps-scatter .ps-point').count() > 0
    assert page.locator('#ps-leaders button').count() == 8
    assert page.locator('#ps-table tbody tr').count() == 15
    page.screenshot(path='/tmp/player-stats-desktop.png', full_page=True)
    source_note = page.locator('#ps-source-note').text_content()
    assert 'unindexed journal files excluded' in source_note, source_note
    page.locator('#ps-next').click()
    assert page.locator('#ps-page').inner_text().startswith('16–30')
    page.locator('#ps-prev').click()
    page.locator('#ps-table [data-sort="personal_kills"]').click()
    assert page.locator('#ps-table th[aria-sort="descending"]').inner_text().startswith('Personal kills')
    page.locator('#ps-table [data-sort="personal_kills"]').click()
    assert page.locator('#ps-table th[aria-sort="ascending"]').count() == 1
    page.locator('#ps-scatter .ps-point').nth(1).focus()
    assert 'rounds; win rate' in page.locator('#ps-scatter-readout').inner_text()
    selected = page.locator('#ps-scatter .ps-point').nth(1).get_attribute('data-player')
    page.keyboard.press('Enter')
    assert page.locator('#ps-player').input_value() == selected
    compare_id = page.locator('#ps-compare option:not([disabled])').nth(1).get_attribute('value')
    page.select_option('#ps-compare', compare_id)
    assert page.locator('#ps-comparison tbody tr').count() == 6
    page.select_option('#ps-history-focus', 'player')
    page.locator('#ps-history .ps-day').first.focus()
    assert 'UTC:' in page.locator('#ps-history-readout').inner_text()
    page.select_option('#ps-min', '0')
    assert page.locator('#ps-summary .ps-stat strong').nth(0).inner_text() == str(len(players))
    # Real names and zero-result players remain searchable; escaping is verified separately.
    name = max(players, key=lambda p: p['totals']['squad_kills'])['name']
    page.locator('#ps-search').fill(name)
    assert name in page.locator('#ps-table').inner_text()
    with page.expect_download() as downloaded:
        page.locator('#ps-export').click()
    download = downloaded.value
    assert download.suggested_filename.endswith('.csv')
    contents = Path(download.path()).read_text(encoding='utf-8-sig')
    assert name in contents and 'Personal K/D' in contents
    page.locator('#ps-search').fill('no-such-player-12345')
    assert page.locator('#ps-summary .ps-stat strong').nth(0).inner_text() == '0'
    assert page.locator('#ps-export').is_disabled()
    assert 'No matching players' in page.locator('#ps-table').inner_text()
    page.locator('#ps-reset').click()
    page.select_option('#ps-min', '0')
    page.select_option('#ps-period', 'custom')
    page.locator('#ps-from').fill('2026-11-04')
    page.locator('#ps-from').press('Tab')
    page.locator('#ps-through').fill('2026-11-04')
    page.locator('#ps-through').press('Tab')
    assert page.locator('#ps-summary .ps-stat strong').nth(1).inner_text() == '0'
    assert page.locator('#ps-summary .ps-stat strong').nth(2).inner_text() == '0'
    page.select_option('#ps-period', '7')
    assert '2026-10-29 → 2026-11-04' in page.locator('#ps-filter-note').inner_text()
    page.locator('#ps-reset').click()
    for width in [390, 768, 1280]:
        page.set_viewport_size({'width': width, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Overflow at {width}'
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_function("document.querySelector('#ps-history').scrollLeft > 0")
    page.screenshot(path='/tmp/player-stats-mobile.png', full_page=True)
    # Existing tabs and browser history continue to work.
    page.locator('#mapstats-tab').click()
    assert page.locator('#mapstats-panel').is_visible()
    page.go_back()
    assert page.locator('#playerstats-panel').is_visible()
    page.locator('#playerstats-tab').focus()
    page.keyboard.press('ArrowRight')
    assert page.locator('#replays-tab').get_attribute('aria-selected') == 'true'
    assert not errors, errors
    browser.close()
print('Player stats desktop/mobile browser checks passed; screenshots saved in /tmp.')
