const timeoutMs = 15000;
export async function request(path = '/api/tasks', method = 'GET', body) {
  let response;
  try {
    response = await fetch(path, {method, cache:'no-store', signal:AbortSignal.timeout(timeoutMs),
      headers:body ? {'Content-Type':'application/json'} : {}, body:body ? JSON.stringify(body) : undefined});
  } catch { throw new Error('无法连接服务器，保存结果尚未确认。请保留输入，刷新数据核对后重试。'); }
  const result = await response.json().catch(() => ({error:'服务器响应格式异常'}));
  if (!response.ok) { const error = new Error(result.error || '请求失败'); error.status = response.status; throw error; }
  return result;
}
