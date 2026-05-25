require("dotenv").config();

const express = require("express");
const compression = require("compression");
const path = require("node:path");
const datesHandler = require("./api/booking/dates");
const timesHandler = require("./api/booking/times");
const createHandler = require("./api/booking/create");
const {
    maibCallbackHandler,
    maibReturnHandler,
} = require("./api/payments/maib");
const {
    sbpayDeletePaymentMethodHandler,
    sbpayFormHandler,
    sbpayRebillHandler,
    sbpayRefundHandler,
} = require("./api/payments/sbpay");

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDir = __dirname;

app.disable("x-powered-by");
app.use(
    express.json({
        limit: "32kb",
        verify(req, _res, buffer) {
            if (buffer.length) {
                req.rawBody = Buffer.from(buffer);
            }
        },
    }),
);
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(compression());

app.get("/api/health", (req, res) => {
    res.json({ ok: true });
});

app.get("/api/booking/dates", datesHandler);
app.get("/api/booking/times", timesHandler);
app.post("/api/booking/create", createHandler);
app.post("/api/payments/sbpay/form", sbpayFormHandler);
app.post("/api/payments/sbpay/refund", sbpayRefundHandler);
app.post("/api/payments/sbpay/rebill", sbpayRebillHandler);
app.post(
    "/api/payments/sbpay/delete-payment-method",
    sbpayDeletePaymentMethodHandler,
);
app.post("/api/payments/maib/callback", maibCallbackHandler);
app.get("/api/payments/maib/return", maibReturnHandler);

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
