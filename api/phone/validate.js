const { json } = require("../_simplybook");
const { getPhoneValidationResult } = require("./_phone");

module.exports = async function handler(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        json(res, 405, {
            ok: false,
            error: {
                code: "METHOD_NOT_ALLOWED",
                message: "Method not allowed.",
            },
        });
        return;
    }

    const url = new URL(req.url || "/api/phone/validate", "http://local");
    const phone = req.query?.phone ?? url.searchParams.get("phone") ?? "";

    json(res, 200, {
        ok: true,
        phone: getPhoneValidationResult(phone),
    });
};
