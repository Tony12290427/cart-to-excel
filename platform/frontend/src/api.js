export async function apiRequest(path, data, csrf = '') {
  const response = await fetch('/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: data === undefined ? {} : {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || '请求失败');
    error.status = response.status;
    throw error;
  }
  return result;
}
