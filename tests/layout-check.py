"""DOM and stylesheet structure checks; actual iPhone rendering is separate."""
from pathlib import Path
from lxml import html
import re
p=Path(__file__).resolve().parents[1]
doc=html.fromstring((p/'index.html').read_text())
app=doc.xpath('//div[@class="app"]')[0]
sandbox=doc.get_element_by_id('sandboxPage')
assert sandbox.getparent().tag=='body'
assert app not in sandbox.iterancestors()
control=doc.get_element_by_id('numTeams')
assert control.getparent().tag=='label' and control.getparent().get('for')=='numTeams'
assert len(doc.xpath('//*[@id="numTeams"]'))==1
css=(p/'theme-4.14.5.css').read_text()
for selectors,body in re.findall(r'([^{}]+)\{([^{}]*)\}',css):
    if 'sandbox-open' in selectors:
        assert not re.search(r'(?:overflow|display|visibility)\s*:',body),selectors
assert 'html.ios-home-screen .app{overflow-y:auto!important;overflow-x:hidden!important}' in css
assert re.search(r'html\.ios-home-screen #sandboxPage\{\s*top:env\(safe-area-inset-top,0px\)!important;',css)
assert 'transform:scale(.988)' not in css
assert 'display:flex;align-items:center;justify-content:space-between' in css
assert re.search(r'html\.ios-home-screen \.topbar\{[^}]*backdrop-filter:none!important;',css)
print('PASS associated compact team-count control, Sandbox outside main scroller, no Sandbox display/overflow switch, inset overlay, and stable row geometry.')
