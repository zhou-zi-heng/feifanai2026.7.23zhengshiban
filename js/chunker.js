/* ===== 飞凡AI - 物理分块打标引擎 (v2.1 · WPS字数口径统一) ===== */
/* 切块按字符位置（精确定位），但对外所有"字数/百分比"均用 cntW（=WPS"字数"口径），
   与消息气泡、WPS 完全一致。标记不计入正文字数。零AI参与，可复现。 */

const Chunker = (function () {

    let DEFAULT_SIZE = 300;   // ★ 默认每块字符数（切块粒度，按字符切）

    function setBlockSize(n) {
        n = parseInt(n, 10);
        if (n && n >= 50 && n <= 5000) DEFAULT_SIZE = n;
    }
    function getBlockSize() { return DEFAULT_SIZE; }

    /* ---------- 字符工具 ---------- */
    function _chars(s) { return [...String(s || '')]; }

    function _isCJK(ch) {
        const c = ch.codePointAt(0);
        return (c >= 0x4E00 && c <= 0x9FFF) ||
               (c >= 0x3400 && c <= 0x4DBF) ||
               (c >= 0x3040 && c <= 0x30FF) ||
               (c >= 0xAC00 && c <= 0xD7A3) ||
               (c >= 0x3000 && c <= 0x303F) ||
               (c >= 0xFF00 && c <= 0xFFEF);
    }
    function _isLatinWordChar(ch) {
        return /[A-Za-z0-9]/.test(ch);
    }

    /* ---------- WPS"字数"口径计数（与气泡 cntW 完全一致） ---------- */
    /* 若全局 cntW 存在则直接复用，保证两处永远同源；否则内置同款算法兜底 */
    function _wc(text) {
        if (typeof cntW === 'function') return cntW(text);
        if (!text) return 0;
        const s = String(text);
        let han;
        try { han = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}\u3000-\u303f\uff00-\uffef]/gu) || []).length; }
        catch (e) { han = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g) || []).length; }
        const words = (s.match(/[a-zA-Z0-9]+(?:['’\-][a-zA-Z0-9]+)*/g) || []).length;
        return han + words;
    }

    /* ========== 净化：去无意义空格 + 清特殊字符 ========== */
    function clean(text) {
        let s = String(text || '');
        s = s.replace(/[\uFEFF\u200B\u200C\u200D\u2060\u180E]/g, '');
        s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
        s = s.replace(/\u3000/g, ' ');

        const arr = _chars(s);
        const out = [];
        for (let i = 0; i < arr.length; i++) {
            const ch = arr[i];
            if (ch === ' ' || ch === '\t') {
                let prev = '';
                for (let j = out.length - 1; j >= 0; j--) {
                    if (out[j] !== ' ' && out[j] !== '\t') { prev = out[j]; break; }
                    if (out[j] === '\n') { prev = '\n'; break; }
                }
                let next = '';
                for (let k = i + 1; k < arr.length; k++) {
                    if (arr[k] !== ' ' && arr[k] !== '\t') { next = arr[k]; break; }
                    if (arr[k] === '\n') { next = '\n'; break; }
                }
                const keep = _isLatinWordChar(prev) && _isLatinWordChar(next);
                if (keep) out.push(' ');
            } else {
                out.push(ch);
            }
        }
        s = out.join('');

        s = s.replace(/\n[ \t]*\n[ \t\n]*/g, '\n\n');
        s = s.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
        s = s.trim();

        return s;
    }

    /* ========== 核心：分块 ==========
       切块位置按字符（精确定位）；每块的"字数"用 _wc（WPS口径）。
       全文总字数、百分比全部基于 _wc 累计，保证与气泡/WPS一致。 */
    function chunk(text, opts) {
        opts = opts || {};
        const size = opts.size || DEFAULT_SIZE;
        const doClean = opts.clean !== false;

        const cleaned = doClean ? clean(text) : String(text || '');
        const chars = _chars(cleaned);
        const totalChars = chars.length;

        // 全文 WPS 字数（对外总数，与气泡一致）
        const totalWords = _wc(cleaned);

        if (!totalChars) return { total: 0, totalWords: 0, size: size, blocks: [], marked: '', cleaned: cleaned };

        const blocks = [];
        let idx = 1, pos = 0, cumWords = 0;
        while (pos < totalChars) {
            const end = Math.min(pos + size, totalChars);
            const body = chars.slice(pos, end).join('');
            const blockWords = _wc(body);              // 本块 WPS 字数
            const wStart = cumWords + 1;               // 本块起始"字序"（词序）
            const wEnd = cumWords + blockWords;        // 本块结束"字序"
            const pctStart = totalWords ? +((cumWords / totalWords) * 100).toFixed(1) : 0;
            cumWords += blockWords;
            const pctEnd = totalWords ? +((cumWords / totalWords) * 100).toFixed(1) : 0;

            blocks.push({
                no: idx++,
                words: blockWords,     // 本块字数（WPS口径）
                wStart: wStart,        // 本块起始字序
                wEnd: wEnd,            // 本块结束字序
                pctStart: pctStart,
                pctEnd: pctEnd,
                text: body,
                // 保留字符位置供内部需要，但不对外展示
                _startChar: pos + 1,
                _endChar: end,
            });
            pos = end;
        }

        return {
            total: totalWords,          // ★ 对外 total 直接就是 WPS 字数
            totalWords: totalWords,
            totalChars: totalChars,     // 内部备用
            size: size,
            blocks: blocks,
            marked: _render(blocks, totalWords),
            cleaned: cleaned,
        };
    }

    /* ---------- 渲染标记文本（全 WPS 字数口径，只保留一种计数） ---------- */
    function _render(blocks, totalWords) {
        const avg = blocks.length ? Math.round(totalWords / blocks.length) : 0;

        let out = '=== 文档分块索引（权威字数数据，禁止自行估算）===\n' +
            '【重要规则】本文档由系统精确切分，以下所有"字数""百分比"均为系统实测的准确值，' +
            '且与常用文字软件（WPS/Word）的"字数"统计口径完全一致。\n' +
            '当你需要说明某段情节的位置、字数或占比时，必须直接引用下方标记中的现成数字，' +
            '严禁自己数字、估算或换算——你的估算一定不准，标记里的数字才是唯一标准。\n' +
            '· 全文精确总字数：' + totalWords + ' 字。\n' +
            '· 共 ' + blocks.length + ' 块，每块约 ' + avg + ' 字。\n' +
            '· 引用规则：情节起于「块X」、止于「块Y」，其字数 = 块Y末字序 − 块X首字序 + 1；占比直接取两端标记的百分比。\n' +
            '· 若情节在某块中间开始/结束，就近取该块边界，并注明"约"。\n\n';

        // 全文进度速查表（基于 WPS 字数）
        out += '=== 全文进度速查表（直接查，不要算）===\n';
        const milestones = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        milestones.forEach(pct => {
            const wordNo = Math.round(totalWords * pct / 100);
            let inBlock = blocks.length;
            for (const b of blocks) { if (wordNo <= b.wEnd) { inBlock = b.no; break; } }
            out += '· 全文 ' + pct + '% ≈ 第 ' + wordNo + ' 字（位于块' + inBlock + '）\n';
        });
        out += '\n';

        // 逐块正文（只显示 WPS 字数口径）
        blocks.forEach(b => {
            out += '▌块' + b.no + '｜首字' + b.wStart + '·末字' + b.wEnd +
                '｜本块' + b.words + '字｜全文进度' + b.pctStart + '%→' + b.pctEnd + '%\n' +
                b.text + '\n\n';
        });
        return out;
    }

    /* ---------- 打标一组附件 ---------- */
    function chunkAttachments(atts, opts) {
        return atts.map(a => {
            if (!a.text || a.type === 'image') return a;
            const r = chunk(a.text, opts);
            return Object.assign({}, a, {
                text: r.marked,
                _chunked: true,
                _chunkInfo: { total: r.total, blocks: r.blocks.length }
            });
        });
    }

    /* ---------- 预览单个附件对象 ---------- */
    function previewOne(att) {
        if (!att || !att.text || att.type === 'image') {
            return '[该附件为图片或无文本，不参与打标]';
        }
        const r = chunk(att.text, {});
        const info = '【文件：' + (att.fileName || att.name || '未命名') +
            '｜净化后总字数：' + r.total + '（WPS口径）｜分 ' + r.blocks.length + ' 块】\n\n';
        return info + r.marked;
    }

    return {
        chunk: chunk,
        clean: clean,
        chunkAttachments: chunkAttachments,
        previewOne: previewOne,
        setBlockSize: setBlockSize,
        getBlockSize: getBlockSize,
        DEFAULT_SIZE: DEFAULT_SIZE,
    };
})();

window.Chunker = Chunker;
