// Prefer the Clipboard API; the legacy fallback supports the deployed HTTP site.
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Permission denied: try selection-based copying, then manual copy. */ }
  const previous = document.activeElement;
  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.tabIndex = -1;
  input.setAttribute('aria-label','临时复制内容');
  input.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px;';
  document.body.append(input);
  try {
    input.focus({preventScroll:true});
    input.select();
    input.setSelectionRange(0,text.length);
    return document.execCommand('copy');
  } catch { return false; }
  finally { input.remove(); previous?.focus({preventScroll:true}); }
}
