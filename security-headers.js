const SECURITY_HEADERS = {
    "Content-Security-Policy":
        "base-uri 'self'; object-src 'none'; frame-ancestors 'self'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
};

const applySecurityHeaders = (_req, res, next) => {
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
        res.setHeader(header, value);
    }

    next();
};

module.exports = {
    SECURITY_HEADERS,
    applySecurityHeaders,
};
