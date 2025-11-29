import express from "express";
const app = express();

// 静态文件服务（把工作目录作为静态文件根）访问项目里的 index.html
app.use(express.static("."));

// 提供一个简单的 HTML 页面，使用 SSE 显示实时时钟
app.get("/sse", (req, res) => {
  // 为跨域访问添加必要的 CORS 头
  const origin = req.headers.origin || "*";
  // 禁用代理缓冲，如果你的请求经过 Nginx 等代理，这个头有助于实时推送
  res.setHeader("X-Accel-Buffering", "no");

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
  });

  // 立即推送头，避免部分服务器/代理延迟发送
  res.flushHeaders && res.flushHeaders();

  // 每秒向客户端发送一次当前时间
  const intervalId = setInterval(() => {
    const now = new Date().toLocaleTimeString();
    res.write(`data: ${now}\n\n`);
  }, 1000);

  // 当客户端断开连接时，清除定时器
  req.on("close", () => {
    clearInterval(intervalId);
    res.end();
  });
});
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
