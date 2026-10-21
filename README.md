# iot-demo

物联网设计与创新课程实践项目。

模拟物联网传感器（温度、湿度）数据的发布与可视化展示。

## 初始功能

- `publisher.js`：MQTT 发布者，每 2 秒生成一组温湿度模拟数据并发布到 MQTT 主题
- `subscriber.js`：MQTT 订阅者，接收指定主题的消息并打印

## 后续计划

使用 Express 为数据添加可视化网页界面，完成网页端实时数据展示。

## 运行

安装依赖：

```bash
npm install
```

发布模拟数据：

```bash
npm run pub
```

订阅并打印（另开终端）：

```bash
npm run sub
```

可视化网页（待添加）：

```bash
npm start
```
