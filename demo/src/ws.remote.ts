import { fnWebSocket } from "monoserve";

export default fnWebSocket(async (ws) => {
  ws.onopen = () => {
    console.log("WebSocket connection opened");
    ws.send("Hello from server");
  };

  ws.onmessage = (event) => {
    console.log("Received message from client:", event.data);
    ws.send(`Echo: ${event.data}`);
  };

  ws.onclose = () => {
    console.log("WebSocket connection closed");
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
});
