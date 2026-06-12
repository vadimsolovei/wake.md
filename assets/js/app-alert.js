(() => {
    const nativeAlert = window.alert.bind(window);
    const alertPopup = document.querySelector("[data-app-alert]");
    const alertDialog =
        alertPopup?.querySelector(".app-alert__dialog");
    const alertTitle = alertPopup?.querySelector(
        "[data-app-alert-title]",
    );
    const alertMessage = alertPopup?.querySelector(
        "[data-app-alert-message]",
    );
    const alertCloseButtons = alertPopup?.querySelectorAll(
        "[data-app-alert-close]",
    );
    const alertButton =
        alertPopup?.querySelector(".app-alert__button");
    const alertQueue = [];
    const bookingPaymentAlerts = {
        success: {
            title: "Оплата прошла",
            message:
                "Бронирование создано. Ждем вас минимум за полчаса до старта.",
        },
        failed: {
            title: "Оплата не завершена",
            message:
                "Платеж не был завершен. Попробуйте еще раз или свяжитесь с нами.",
        },
        error: {
            title: "Статус оплаты не проверен",
            message:
                "Если оплата прошла, свяжитесь с нами, и мы проверим бронирование.",
        },
    };

    let activeAlert = null;
    let lastFocusedAlertElement = null;

    const normalizeAlertOptions = (options) => {
        if (
            options &&
            typeof options === "object" &&
            !Array.isArray(options)
        ) {
            return {
                title: String(options.title || "Сообщение"),
                message: String(options.message ?? ""),
            };
        }

        return {
            title: "Сообщение",
            message: String(options ?? ""),
        };
    };

    const showBookingPaymentAlert = () => {
        const url = new URL(window.location.href);
        const paymentStatus = url.searchParams.get("booking_payment");
        const alert = bookingPaymentAlerts[paymentStatus];

        if (!alert) return;

        url.searchParams.delete("booking_payment");
        window.history.replaceState(
            window.history.state,
            "",
            `${url.pathname}${url.search}${url.hash}`,
        );
        window.showAppAlert(alert);
    };

    if (
        !alertPopup ||
        !alertDialog ||
        !alertTitle ||
        !alertMessage
    ) {
        window.showAppAlert = async (options) => {
            const { message } = normalizeAlertOptions(options);
            nativeAlert(message);
        };
        showBookingPaymentAlert();
        return;
    }

    const isAppAlertOpen = () =>
        Boolean(activeAlert && !alertPopup.hidden);

    const openNextAlert = () => {
        if (activeAlert || !alertQueue.length) return;

        activeAlert = alertQueue.shift();
        lastFocusedAlertElement = document.activeElement;
        alertTitle.textContent = activeAlert.title;
        alertMessage.textContent = activeAlert.message;
        alertPopup.hidden = false;
        alertPopup.setAttribute("aria-hidden", "false");
        document.documentElement.classList.add("has-app-alert");
        document.body.classList.add("has-app-alert");

        window.requestAnimationFrame(() => {
            (alertButton || alertDialog).focus();
        });
    };

    const closeAppAlert = () => {
        if (!activeAlert) return;

        const { resolve } = activeAlert;
        alertPopup.setAttribute("aria-hidden", "true");
        alertPopup.hidden = true;
        document.documentElement.classList.remove("has-app-alert");
        document.body.classList.remove("has-app-alert");

        if (lastFocusedAlertElement instanceof HTMLElement) {
            lastFocusedAlertElement.focus();
        }

        activeAlert = null;
        lastFocusedAlertElement = null;
        resolve();
        openNextAlert();
    };

    window.showAppAlert = (options) =>
        new Promise((resolve) => {
            alertQueue.push({
                ...normalizeAlertOptions(options),
                resolve,
            });
            openNextAlert();
        });

    window.alert = (message) => {
        window.showAppAlert(message);
    };

    alertCloseButtons?.forEach((button) => {
        button.addEventListener("click", closeAppAlert);
    });

    document.addEventListener(
        "keydown",
        (event) => {
            if (event.key !== "Escape" || !isAppAlertOpen()) return;

            event.preventDefault();
            event.stopPropagation();
            closeAppAlert();
        },
        true,
    );

    showBookingPaymentAlert();
})();
