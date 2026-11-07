/*
MIT License

Copyright (c) 2026 Zeaden

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

// 只计算接管后的开关状态；null 表示保持酒馆原生行为。
export function governedState(settings, selection, book, uid, originalEnabled) {
    const cfg = settings.entryBooks.find(item => item.name === book);
    if (cfg) {
        const bucket = cfg.assignments[String(uid)] ?? 'unmanaged';
        if (bucket === 'unmanaged') return null;
        if (bucket === 'always_on') return true;
        if (bucket === 'always_off') return false;
        return (selection?.groups?.[book]?.[bucket] ?? []).includes(String(uid));
    }
    if (settings.toggleBooks.includes(book)) {
        return selection?.toggles?.[book] !== false && originalEnabled;
    }
    return null;
}

const activeSyncs = new WeakMap();

// 不触发原生 click/input/change，不接触世界书数据或保存接口。
export function createNativePanelSync({ document, worldNames, getSettings, getSelection, getCaptured }) {
    if (!document?.body || typeof MutationObserver !== 'function') return () => {};
    activeSyncs.get(document)?.();
    const managed = new Map();
    let timer = null;
    let disposed = false;
    let list = document.getElementById('world_popup_entries_list');
    const observer = new MutationObserver(schedule);
    const lifecycle = new MutationObserver(records => {
        const next = document.getElementById('world_popup_entries_list');
        if (next !== list) {
            observer.disconnect();
            list = next;
            schedule();
            return;
        }
        // Ignore unrelated chat rendering and counters.
        if (list && records.some(record => record.target === list ||
            ((record.type === 'attributes' || record.target !== document.body) && record.target.contains?.(list)))) schedule();
    });
    function isOpen() {
        return list?.isConnected && list.getClientRects().length > 0 &&
            document.defaultView.getComputedStyle(list).visibility !== 'hidden';
    }
    const observe = () => {
        if (!disposed && isOpen()) observer.observe(list, {
            childList: true, subtree: true, attributes: true,
            attributeFilter: ['class', 'uid', 'data-current-world', 'data-uid'],
        });
    };
    function restore(row, state) {
        state.bar.remove();
        state.original.hidden = state.hidden;
        if (state.display) state.original.style.setProperty('display', state.display, state.priority);
        else state.original.style.removeProperty('display');
        row.classList.toggle('disabledWIEntry', state.disabled);
        managed.delete(row);
    }
    function sync() {
        timer = null;
        if (disposed) return;
        observer.disconnect();
        // Hidden panels may retain thousands of rows: never enumerate them.
        if (!isOpen()) return;
        try {
            const select = document.querySelector('#world_editor_select');
            const book = select && select.value !== '' ? worldNames[select.value] : null;
            const settings = getSettings();
            const selection = getSelection();
            const rows = new Set(list.querySelectorAll('.world_entry[uid]'));
            for (const [row, state] of managed) {
                if (!rows.has(row) || state.book !== book || state.uid !== row.getAttribute('uid') ||
                    !row.contains(state.original) || !row.contains(state.bar)) restore(row, state);
            }
            for (const row of rows) {
                const uid = row.getAttribute('uid');
                const original = row.querySelector('div[name="entryKillSwitch"]');
                const identity = row.querySelector('.move_entry_button[data-current-world][data-uid]');
                // 同时核对书名和 UID，不用标题、行号或模糊匹配猜身份。
                const compatible = book && original && identity &&
                    identity.getAttribute('data-current-world') === book && identity.getAttribute('data-uid') === uid;
                let state = managed.get(row);
                const originalEnabled = state ? !state.disabled : !row.classList.contains('disabledWIEntry');
                const expected = compatible ? governedState(settings, selection, book, uid, originalEnabled) : null;
                if (expected === null || (!state && !original.classList.contains('fa-toggle-on') && !original.classList.contains('fa-toggle-off'))) {
                    if (state) restore(row, state);
                    continue;
                }
                if (!state) {
                    const visual = document.createElement('span');
                    visual.className = 'fa-solid lg-native-toggle';
                    visual.setAttribute('role', 'img');
                    // 不复制原生节点或事件，防止误触发写回。
                    visual.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); });
                    const badge = document.createElement('small');
                    badge.className = 'lg-native-badge';
                    badge.textContent = '聊天配置 · 会同步到原书';
                    // 独立一行放在条目最上面：不依赖原生标题栏的排布，装了「原版世界书优化」之类改布局的插件也能看到、点到。
                    const bar = document.createElement('div');
                    bar.className = 'lg-native-bar';
                    bar.append(visual, badge);
                    state = { book, uid, original, visual, badge, bar, hidden: original.hidden, display: original.style.getPropertyValue('display'), priority: original.style.getPropertyPriority('display'), disabled: row.classList.contains('disabledWIEntry') };
                    managed.set(row, state);
                    original.hidden = true;
                    original.style.setProperty('display', 'none', 'important');
                    row.prepend(bar);
                }
                const enabled = getCaptured(book, uid)?.enabled ?? expected;
                if (row.classList.contains('disabledWIEntry') !== !enabled) {
                    row.classList.toggle('disabledWIEntry', !enabled);
                }
                if (state.enabled === enabled) continue;
                state.enabled = enabled;
                state.visual.classList.toggle('fa-toggle-on', enabled);
                state.visual.classList.toggle('fa-toggle-off', !enabled);
                state.visual.setAttribute('aria-label', '聊天配置：' + (enabled ? '启用' : '关闭'));
                state.visual.title = 'Lore Governor 当前聊天：' + (enabled ? '启用' : '关闭') + '。请在扩展中配置；改动会自动同步到原书的开关。启用仍需满足关键词、概率等原生触发条件。';
                state.badge.title = state.visual.title;
            }
        } catch {
            // 遇到未知版本或 DOM 时，撤下自己的显示，归还原生控件。
            for (const [row, state] of managed) restore(row, state);
        } finally {
            observe();
        }
    }
    function schedule() {
        if (disposed || timer !== null) return;
        // Coalesce events across tasks and read the latest chat when running.
        timer = setTimeout(sync, 50);
    }
    function onChange(event) {
        if (event.target?.id === 'world_editor_select') schedule();
    }
    function dispose() {
        disposed = true;
        clearTimeout(timer);
        observer.disconnect();
        lifecycle.disconnect();
        document.removeEventListener('change', onChange);
        for (const [row, state] of managed) restore(row, state);
        if (activeSyncs.get(document) === dispose) activeSyncs.delete(document);
    }
    document.addEventListener('change', onChange);
    // Only a lightweight lifecycle watcher remains while the panel is closed.
    lifecycle.observe(document.body, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style', 'hidden'],
    });
    activeSyncs.set(document, dispose);
    schedule.dispose = dispose;
    schedule();
    return schedule;
}
