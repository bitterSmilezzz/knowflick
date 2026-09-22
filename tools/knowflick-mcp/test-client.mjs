/** 测试专用 JSON-RPC 客户端：按行组帧、按 id 配对，失败有界。 */
export function rpcClient(child, timeoutMs = 5000) {
  const pending = new Map();
  let buffer = "";
  let failure;
  let stderr = "";
  const fail = (error) => {
    failure = error;
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  };
  child.stderr?.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  child.on("error", fail);
  child.on("close", (code) => fail(new Error(`子进程已退出 (${code}): ${stderr}`)));
  child.stdin.on("error", fail);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let cut;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } catch (error) { fail(error); }
    }
  });
  return (payload) => new Promise((resolve, reject) => {
    if (failure) return reject(failure);
    if (pending.has(payload.id)) return reject(new Error(`重复请求 id: ${payload.id}`));
    const timer = setTimeout(() => {
      pending.delete(payload.id);
      reject(new Error(`请求超时: ${payload.method} (${payload.id})`));
    }, timeoutMs);
    pending.set(payload.id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}
