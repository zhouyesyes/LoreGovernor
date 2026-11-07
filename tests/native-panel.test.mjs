import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createNativePanelSync, governedState } from '../native-panel.mjs';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
const wait = () => new Promise(resolve => setTimeout(resolve, 100));

test('面板生命周期、事件合并和只读视觉同步', async () => {
    const dom = new JSDOM(`<div id="chat"></div><section id="panel" hidden>
        <select id="world_editor_select"><option value="0">Book</option></select>
        <div id="world_popup_entries_list"><div class="world_entry" uid="1">
        <div name="entryKillSwitch" class="fa-toggle-on"></div>
        <span class="move_entry_button" data-current-world="Book" data-uid="1"></span>
        </div></div></section>`);
    const { document, MutationObserver } = dom.window;
    globalThis.MutationObserver = MutationObserver;
    const panel = document.getElementById('panel');
    const list = document.getElementById('world_popup_entries_list');
    list.getClientRects = () => panel.hidden ? [] : [{}];
    let scans = 0;
    const query = list.querySelectorAll.bind(list);
    list.querySelectorAll = (...args) => { scans++; return query(...args); };
    let selection = { groups: { Book: { group: ['1'] } } };
    const settings = { entryBooks: [{ name: 'Book', assignments: { 1: 'group' } }], toggleBooks: [] };
    const before = JSON.stringify(settings);
    let nativeEvents = 0;
    for (const type of ['click', 'input', 'change']) document.addEventListener(type, () => nativeEvents++);
    const options = { document, worldNames: ['Book'], getSettings: () => settings,
        getSelection: () => selection, getCaptured: () => null };
    let sync = createNativePanelSync(options);
    try {
        for (let i = 0; i < 20; i++) sync();
        await wait();
        assert.equal(scans, 0, '关闭时不扫描');
        panel.hidden = false;
        await wait();
        assert.equal(scans, 1);
        assert.equal(document.querySelectorAll('.lg-native-badge').length, 1);
        assert.match(document.querySelector('.lg-native-badge').textContent, /不写回原书/);
        let writes = 0;
        const watcher = new MutationObserver(records => writes += records.length);
        watcher.observe(list, { subtree: true, childList: true, attributes: true });
        for (let i = 0; i < 20; i++) sync();
        await wait();
        assert.equal(scans, 2, '通知合并为一次扫描');
        assert.equal(writes, 0, '状态不变无 DOM 写入');
        document.getElementById('chat').innerHTML = '<div class="message">chat</div>';
        await wait();
        assert.equal(scans, 2, '聊天 DOM 不触发同步');
        selection = { groups: {} };
        sync();
        await wait();
        assert.ok(document.querySelector('.world_entry').classList.contains('disabledWIEntry'));
        const settled = scans;
        await wait();
        assert.equal(scans, settled, '自身写入不循环');
        watcher.disconnect();
        panel.hidden = true;
        await wait();
        sync();
        await wait();
        assert.equal(scans, settled);
        panel.hidden = false;
        await wait();
        sync = createNativePanelSync(options);
        await wait();
        assert.equal(document.querySelectorAll('.lg-native-badge').length, 1, '重初始化不叠加');
        assert.equal(nativeEvents, 0);
        assert.equal(JSON.stringify(settings), before);
        settings.entryBooks[0].assignments = {};
        sync();
        await wait();
        assert.equal(document.querySelectorAll('.lg-native-badge').length, 0);
        assert.equal(document.querySelector('[name="entryKillSwitch"]').hidden, false);
    } finally {
        sync.dispose();
        dom.window.close();
        delete globalThis.MutationObserver;
    }
});

test('受管状态保留原有分组和整本语义', () => {
    const settings = { entryBooks: [{ name: 'B', assignments: { 1: 'always_on', 2: 'always_off', 3: 'g' } }], toggleBooks: ['T'] };
    assert.equal(governedState(settings, null, 'B', 1, false), true);
    assert.equal(governedState(settings, null, 'B', 2, true), false);
    assert.equal(governedState(settings, { groups: { B: { g: ['3'] } } }, 'B', 3, false), true);
    assert.equal(governedState(settings, null, 'B', 4, true), null);
    assert.equal(governedState(settings, null, 'T', 1, false), false);
    assert.equal(governedState(settings, { toggles: { T: false } }, 'T', 1, true), false);
});
