require("dotenv").config();

const express = require("express");
const compression = require("compression");
const fs = require("node:fs");
const path = require("node:path");
const datesHandler = require("./api/booking/dates");
const timesHandler = require("./api/booking/times");
const createHandler = require("./api/booking/create");
const phoneValidateHandler = require("./api/phone/validate");
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
const isProduction = process.env.NODE_ENV === "production";
const publicDir = isProduction ? path.join(__dirname, "dist") : __dirname;
const indexPath = path.join(publicDir, "index.html");
const taplinkIndexPath = path.join(publicDir, "taplink", "index.html");
const versionedAssetPaths = [
    "styles.css",
    "assets/js/app-alert.js",
    "assets/js/booking.js",
    "assets/js/main.js",
];

function setNoStoreHeaders(res) {
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
}

function getAssetVersion(assetPath) {
    const absolutePath = path.join(publicDir, assetPath);

    return String(Math.trunc(fs.statSync(absolutePath).mtimeMs));
}

function addAssetVersions(html) {
    if (isProduction) {
        return html;
    }

    return versionedAssetPaths.reduce((updatedHtml, assetPath) => {
        const version = getAssetVersion(assetPath);
        const versionedPath = `${assetPath}?v=${version}`;

        return updatedHtml.replaceAll(assetPath, versionedPath);
    }, html);
}

function sendIndex(req, res, next) {
    fs.readFile(indexPath, "utf8", (error, html) => {
        if (error) {
            next(error);
            return;
        }

        try {
            setNoStoreHeaders(res);
            res.type("html").send(addAssetVersions(html));
        } catch (assetError) {
            next(assetError);
        }
    });
}

function sendTaplinkIndex(req, res, next) {
    setNoStoreHeaders(res);
    res.sendFile(taplinkIndexPath, (error) => {
        if (error) {
            next(error);
        }
    });
}

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
app.get("/api/phone/validate", phoneValidateHandler);
app.post("/api/payments/sbpay/form", sbpayFormHandler);
app.post("/api/payments/sbpay/refund", sbpayRefundHandler);
app.post("/api/payments/sbpay/rebill", sbpayRebillHandler);
app.post(
    "/api/payments/sbpay/delete-payment-method",
    sbpayDeletePaymentMethodHandler,
);
app.post("/api/payments/maib/callback", maibCallbackHandler);
app.get("/api/payments/maib/return", maibReturnHandler);

app.get(["/", "/index.html"], sendIndex);
app.get(["/taplink", "/taplink/", "/taplink/index"], sendTaplinkIndex);

app.use((req, res, next) => {
    if (
        isProduction &&
        /^\/assets\/.+\.[a-f0-9]{10}\.(?:css|js)$/i.test(req.path)
    ) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else if (!isProduction && /\.(?:css|js)$/i.test(req.path) && req.query.v) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else if (req.path.endsWith(".html")) {
        setNoStoreHeaders(res);
    }

    next();
});

app.use(express.static(publicDir, { index: false }));

app.use((req, res, next) => {
    if (isProduction && path.extname(req.path)) {
        res.status(404).end();
        return;
    }

    next();
});

app.get("*", sendIndex);

app.listen(port, "127.0.0.1", () => {
    console.log(`Wake.md server listening on http://127.0.0.1:${port}`);
});
