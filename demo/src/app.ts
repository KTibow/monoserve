import "./app.css";
import echo from "./echo.remote";

const input = document.querySelector("textarea") as HTMLTextAreaElement;
const output = document.querySelector("output") as HTMLOutputElement;
const button = document.querySelector("button") as HTMLButtonElement;

button.addEventListener("click", async () => {
  const text = input.value;
  const echoed = await echo(text);
  output.textContent = echoed;
});
