require("dotenv").config();

const express = require("express");
const path = require("node:path");
const datesHandler = require("./api/booking/dates");
const timesHandler = require("./api/booking/times");
const createHandler = require("./api/booking/create");

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDir = __dirname;

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (req, res) => {
    res.json({ ok: true });
});

app.get("/api/booking/dates", datesHandler);
app.get("/api/booking/times", timesHandler);
app.post("/api/booking/create", createHandler);

app.use(
    express.static(publicDir, {
        extensions: ["html"],
        index: "index.html",
    }),
);

app.get("*", (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, "127.0.0.1", () => {
    console.log(`Wake.md server listening on http://127.0.0.1:${port}`);
});
