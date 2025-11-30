import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { AsyncLocalStorage } from "node:async_hooks";

import express from "express";
import pino from "pino";

// 基础日志记录器（Pino）与异步上下文存储（AsyncLocalStorage）初始化
// 通过 child logger 绑定上下文字段，实现结构化日志在异步链路中的自动传递
const logger = pino();
const asyncLocalStorage = new AsyncLocalStorage();

const app = express();
// 将传入的 `data` 绑定为日志上下文，并在该上下文中执行 `callback`
// 用于把结构化日志的维度（如请求ID、用户ID）在异步调用链中自动传递
// data: 需要绑定到日志的键值，如 { "request.id": "..." }
// callback: 在绑定后的上下文内要执行的函数
function withLogContext(data, callback) {
  const store = asyncLocalStorage.getStore();
  // 获取当前上下文的 logger，没有就用基础 logger
  const parentLogger = store?.get("logger") || logger;

  // 基于新数据创建一个子 logger
  const childLogger = parentLogger.child(data);

  // 创建一个继承父上下文的新 store
  const newStore = new Map(store);
  // 用新的子 logger 覆盖掉旧的 logger
  newStore.set("logger", childLogger);

  // 在这个增强了的上下文里运行 callback
  return asyncLocalStorage.run(newStore, callback);
}
app.use(express.json());

// 请求级中间件：
// - 生成/接收 requestId
// - 输出进入请求日志
// - 在响应结束时按状态级别输出完成日志，并记录耗时
// - 初始化 AsyncLocalStorage 的 store，并将带有 requestId 的 logger 放入上下文
// - 使用 withLogContext 保证下游日志自动携带 request.id
app.use((req, res, next) => {
  const start = performance.now();
  const requestId = req.headers["x-request-id"] || randomUUID();

  const { method, url, ip, headers } = req;
  const userAgent = headers["user-agent"];

  const reqLogger = logger.child({
    "request.id": requestId,
  });

  reqLogger.info(
    {
      "http.request.method": method,
      "url.path": url,
      "client.address": ip,
      "user_agent.original": userAgent,
    },
    `incoming ${method} request to ${url}`
  );

  res.on("finish", () => {
    const { statusCode } = res;

    const logData = {
      duration_ms: performance.now() - start,
      status_code: statusCode,
    };

    if (statusCode >= 500) {
      reqLogger.error(logData, "server error");
    } else if (statusCode >= 400) {
      reqLogger.warn(logData, "client error");
    } else {
      reqLogger.info(logData, "request completed");
    }
  });

  const store = new Map();

  asyncLocalStorage.run(store, () => {
    // 把带上下文的 logger 存入 AsyncLocalStorage
    asyncLocalStorage.getStore().set("logger", reqLogger);

    // next();
    withLogContext({ "request.id": requestId }, next);
  });
});
// 取出当前请求上下文中的 logger；如果不存在则退回到基础 logger
function getLogger() {
  // 如果当前处于请求上下文，就返回对应 logger，否则返回基础 logger
  return asyncLocalStorage.getStore()?.get("logger") || logger;
}
// 从远程服务获取用户信息；如果失败抛出错误
// 成功时在当前上下文 logger 中记录结构化日志
async function fetchUser(id) {
  const response = await fetch(
    `https://jsonplaceholder.typicode.com/users/${id}`
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch user: ${response.status} ${response.statusText}`
    );
  }

  const user = await response.json();
  //   logger.info(`profile info for user ${user.id} retrieved successfully`);
  //   return user;
  getLogger().info(`profile info for user ${id} retrieved successfully`);

  return user;
}

// 演示路由：随机选择一个用户ID，绑定到日志上下文，
// 然后调用 fetchUser 并返回结果；该路由里的所有日志都会自动携带 user.id
app.get("/fetch-user", async (req, res) => {
  const userID = Math.floor(Math.random() * 10) + 1;
  //   //   logger.info("fetching user data");
  //   getLogger().info("fetching user data");
  //   const user = await fetchUser(userID);
  //   res.json(user);
  withLogContext({ "user.id": userID }, async () => {
    getLogger().info("fetching user data");
    const user = await fetchUser(userID);
    res.json(user);
  });
});

// 启动 HTTP 服务并输出启动日志
app.listen(3000, () => {
  logger.info("Server listening on port 3000");
});
