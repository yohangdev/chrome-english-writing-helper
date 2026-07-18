/**
 * Minimal word-level diff (LCS). Classic script → globalThis.LH.diff.
 * Returns ops: [{type:'equal'|'insert'|'delete', text}] where
 *   delete = present in original, removed
 *   insert = present in result, added
 * Suitable for inline rendering: equal plain, delete strikethrough, insert highlighted.
 */
(function () {
  const LH = (globalThis.LH = globalThis.LH || {});

  /** Split into tokens preserving whitespace, so reassembly is lossless. */
  function tokenize(s) {
    return String(s == null ? '' : s).match(/\s+|[^\s]+/g) || [];
  }

  function diffWords(a, b) {
    const A = tokenize(a);
    const B = tokenize(b);
    const n = A.length;
    const m = B.length;

    // LCS length table.
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    const ops = [];
    let i = 0;
    let j = 0;
    const push = (type, text) => {
      const last = ops[ops.length - 1];
      if (last && last.type === type) last.text += text;
      else ops.push({ type, text });
    };

    while (i < n && j < m) {
      if (A[i] === B[j]) {
        push('equal', A[i]);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        push('delete', A[i]);
        i++;
      } else {
        push('insert', B[j]);
        j++;
      }
    }
    while (i < n) push('delete', A[i++]);
    while (j < m) push('insert', B[j++]);

    return ops;
  }

  LH.diff = { tokenize, diffWords };
})();
