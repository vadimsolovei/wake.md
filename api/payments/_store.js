const fs = require("node:fs");
const path = require("node:path");

const emptyStore = () => ({ orders: {} });

const readStoreFile = (filePath) => {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

        if (!data || typeof data !== "object" || !data.orders) {
            return emptyStore();
        }

        return data;
    } catch (error) {
        if (error.code === "ENOENT") return emptyStore();
        throw error;
    }
};

const writeStoreFile = (filePath, data) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(tempPath, filePath);
};

const createPaymentStore = (filePath) => {
    const read = () => readStoreFile(filePath);
    const write = (data) => writeStoreFile(filePath, data);

    return {
        get(orderId) {
            const data = read();

            return data.orders[String(orderId)] || null;
        },

        findByCheckoutId(checkoutId) {
            const data = read();

            return (
                Object.values(data.orders).find(
                    (order) => order.checkoutId === checkoutId,
                ) || null
            );
        },

        save(order) {
            const data = read();
            const orderId = String(order.orderId);
            const previous = data.orders[orderId] || {};
            const now = new Date().toISOString();

            data.orders[orderId] = {
                ...previous,
                ...order,
                orderId,
                createdAt: previous.createdAt || order.createdAt || now,
                updatedAt: now,
            };

            write(data);

            return data.orders[orderId];
        },
    };
};

module.exports = {
    createPaymentStore,
};
