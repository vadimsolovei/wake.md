(() => {
    const desktopMinWidth = 768;
    const desktopBaseWidth = 1440;
    const pageScale = document.querySelector(".page-scale");
    const page = document.querySelector(".page");

    if (!pageScale || !page) return;

    let frameRequest = null;

    const updateDesktopScale = () => {
        if (frameRequest) {
            window.cancelAnimationFrame(frameRequest);
        }

        frameRequest = window.requestAnimationFrame(() => {
            frameRequest = null;

            if (window.innerWidth < desktopMinWidth) {
                document.documentElement.style.removeProperty(
                    "--desktop-scale",
                );
                document.documentElement.style.removeProperty(
                    "--activity-emoji-bottom-offset",
                );
                pageScale.style.removeProperty("height");
                return;
            }

            const scale = window.innerWidth / desktopBaseWidth;

            document.documentElement.style.setProperty(
                "--desktop-scale",
                scale,
            );
            document.documentElement.style.setProperty(
                "--activity-emoji-bottom-offset",
                `${20 / scale}px`,
            );
            pageScale.style.height = `${page.offsetHeight * scale}px`;
        });
    };

    window.addEventListener("load", updateDesktopScale);
    window.addEventListener("resize", updateDesktopScale);
    document.fonts?.ready.then(updateDesktopScale);
    Array.from(document.images).forEach((image) => {
        if (image.complete) return;

        image.addEventListener("load", updateDesktopScale, {
            once: true,
        });
        image.addEventListener("error", updateDesktopScale, {
            once: true,
        });
    });

    updateDesktopScale();
})();

(() => {
    const ctaSource = document.querySelector("[data-cta-source]");
    const floatingCta = document.querySelector(
        "[data-cta-floating]",
    );

    if (!ctaSource || !floatingCta) return;

    const setFloatingCtaVisible = (isVisible) => {
        floatingCta.classList.toggle("is-visible", isVisible);
        floatingCta.toggleAttribute("inert", !isVisible);
        floatingCta.setAttribute("aria-hidden", String(!isVisible));
    };

    const updateFloatingCta = () => {
        const rect = ctaSource.getBoundingClientRect();
        const sourceIsVisible =
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth;

        setFloatingCtaVisible(!sourceIsVisible);
    };

    if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(
            ([entry]) => {
                setFloatingCtaVisible(!entry.isIntersecting);
            },
            { threshold: 0 },
        );

        observer.observe(ctaSource);
        return;
    }

    window.addEventListener("scroll", updateFloatingCta, {
        passive: true,
    });
    window.addEventListener("resize", updateFloatingCta);
    updateFloatingCta();
})();

(() => {
    const telegramCard = document.querySelector(".telegram-card");

    if (!telegramCard) return;

    const minScrollY = 224;
    let hasScrolledEnough = window.scrollY >= minScrollY;
    let cardIsVisible = false;
    let observer = null;

    const cardIntersectsViewport = () => {
        const rect = telegramCard.getBoundingClientRect();

        return (
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth
        );
    };

    const cleanup = () => {
        window.removeEventListener("scroll", updateBadgeAlert);
        window.removeEventListener("resize", updateBadgeAlert);
        observer?.disconnect();
    };

    const showBadgeAlert = () => {
        telegramCard.classList.add("has-badge-alert");
        cleanup();
    };

    const updateBadgeAlert = () => {
        hasScrolledEnough = window.scrollY >= minScrollY;

        if (!observer) {
            cardIsVisible = cardIntersectsViewport();
        }

        if (hasScrolledEnough && cardIsVisible) {
            showBadgeAlert();
        }
    };

    if ("IntersectionObserver" in window) {
        observer = new IntersectionObserver(
            ([entry]) => {
                cardIsVisible = entry.isIntersecting;
                updateBadgeAlert();
            },
            { threshold: 0 },
        );

        observer.observe(telegramCard);
    } else {
        window.addEventListener("resize", updateBadgeAlert);
    }

    window.addEventListener("scroll", updateBadgeAlert, {
        passive: true,
    });
    updateBadgeAlert();
})();

if (window.Swiper) {
    const stepEmotions = [
        "😌",
        "🙂",
        "😬",
        "😐",
        "😳",
        "😏",
        "😃",
        "🤩",
    ];
    const stepsIndicator =
        document.querySelector(".scroll-indicator");
    const stepsIndicatorBar = document.querySelector(
        ".scroll-indicator__bar",
    );
    const stepsIndicatorHandle = document.querySelector(
        ".scroll-indicator__handle",
    );
    const stepsElement = document.querySelector(".steps");

    const getStepsSlidesOffsetAfter = () => {
        if (!stepsElement) return 0;

        const firstSlide =
            stepsElement.querySelector(".swiper-slide");
        if (!firstSlide) return 0;

        return Math.max(
            stepsElement.clientWidth - firstSlide.clientWidth,
            0,
        );
    };

    const updateStepsIndicator = (swiper) => {
        if (!stepsIndicator || !stepsIndicatorHandle) return;

        const maxIndex = Math.max(swiper.slides.length - 1, 1);
        const progress = swiper.realIndex / maxIndex;

        stepsIndicator.style.setProperty(
            "--steps-progress",
            progress,
        );
        stepsIndicatorHandle.textContent =
            stepEmotions[swiper.realIndex] || stepEmotions[0];
        stepsIndicator.setAttribute(
            "aria-label",
            `Learning step ${swiper.realIndex + 1} of ${swiper.slides.length}`,
        );
    };

    const videoCarousel = new Swiper(".video-carousel", {
        slidesPerView: "auto",
        spaceBetween: 8,
        centeredSlides: false,
        grabCursor: true,
        watchSlidesProgress: true,
        keyboard: {
            enabled: true,
        },
        navigation: false,
        pagination: {
            el: ".video-carousel__pagination",
            clickable: true,
        },
        breakpoints: {
            768: {
                spaceBetween: 8,
            },
            1200: {
                spaceBetween: 8,
            },
        },
        on: {
            slideChange() {
                document
                    .querySelectorAll(".video-carousel video")
                    .forEach((video) => {
                        video.pause();
                    });
            },
        },
    });

    const stepsCarousel = new Swiper(".steps", {
        slidesPerView: "auto",
        spaceBetween: 20,
        slidesOffsetAfter: getStepsSlidesOffsetAfter(),
        centeredSlides: true,
        grabCursor: true,
        keyboard: {
            enabled: true,
        },
        breakpoints: {
            0: {
                spaceBetween: 8,
            },
            768: {
                spaceBetween: 16,
            },
            1200: {
                spaceBetween: 20,
            },
        },
        on: {
            init(swiper) {
                updateStepsIndicator(swiper);
            },
            slideChange(swiper) {
                updateStepsIndicator(swiper);
            },
        },
    });

    window.addEventListener("resize", () => {
        stepsCarousel.params.slidesOffsetAfter =
            getStepsSlidesOffsetAfter();
        stepsCarousel.update();
        updateStepsIndicator(stepsCarousel);
    });

    if (stepsIndicator && stepsIndicatorBar) {
        let isDraggingStepsIndicator = false;

        const getStepIndexFromPointer = (event) => {
            const rect = stepsIndicatorBar.getBoundingClientRect();
            const progress = Math.min(
                Math.max(
                    (event.clientX - rect.left) / rect.width,
                    0,
                ),
                1,
            );

            return Math.round(
                progress * (stepsCarousel.slides.length - 1),
            );
        };

        const goToStepFromPointer = (event) => {
            const targetIndex = getStepIndexFromPointer(event);

            stepsCarousel.slideTo(targetIndex);
        };

        stepsIndicator.addEventListener("pointerdown", (event) => {
            isDraggingStepsIndicator = true;
            stepsIndicator.classList.add("is-dragging");
            stepsIndicator.setPointerCapture(event.pointerId);
            goToStepFromPointer(event);
        });

        stepsIndicator.addEventListener("pointermove", (event) => {
            if (!isDraggingStepsIndicator) return;

            goToStepFromPointer(event);
        });

        stepsIndicator.addEventListener("pointerup", (event) => {
            if (!isDraggingStepsIndicator) return;

            isDraggingStepsIndicator = false;
            stepsIndicator.classList.remove("is-dragging");
            goToStepFromPointer(event);
        });

        stepsIndicator.addEventListener("pointercancel", () => {
            isDraggingStepsIndicator = false;
            stepsIndicator.classList.remove("is-dragging");
        });
    }
}

(() => {
    const gallery = document.querySelector(".gallery-carousel");
    const galleryTracks = [
        ...document.querySelectorAll(".gallery-track"),
    ];

    if (!gallery || !galleryTracks.length) return;

    const offsets = new WeakMap();
    let activeTrack = null;
    let activeRow = null;
    let startX = 0;
    let startOffset = 0;

    const getLoopWidth = (row) => {
        const gap = parseFloat(
            getComputedStyle(row).columnGap || "0",
        );

        return row.scrollWidth / 2 + gap / 2;
    };

    const normalizeOffset = (row, offset) => {
        const loopWidth = getLoopWidth(row);

        if (!loopWidth) return offset;

        const halfLoopWidth = loopWidth / 2;

        return (
            ((((offset + halfLoopWidth) % loopWidth) + loopWidth) %
                loopWidth) -
            halfLoopWidth
        );
    };

    const setRowOffset = (row, offset) => {
        const normalizedOffset = normalizeOffset(row, offset);

        offsets.set(row, normalizedOffset);
        row.style.setProperty(
            "--gallery-drag-offset",
            `${normalizedOffset}px`,
        );
    };

    galleryTracks.forEach((track) => {
        const row = track.querySelector(".gallery-row");

        if (!row) return;

        offsets.set(row, 0);
        row.style.setProperty("--gallery-drag-offset", "0px");

        track.addEventListener("dragstart", (event) => {
            event.preventDefault();
        });

        track.addEventListener("pointerdown", (event) => {
            if (
                event.pointerType === "mouse" &&
                event.button !== 0
            ) {
                return;
            }

            activeTrack = track;
            activeRow = row;
            startX = event.clientX;
            startOffset = offsets.get(row) || 0;
            track.classList.add("is-dragging");
            track.setPointerCapture(event.pointerId);
        });

        track.addEventListener("pointermove", (event) => {
            if (activeTrack !== track || !activeRow) return;

            const deltaX = event.clientX - startX;

            setRowOffset(activeRow, startOffset + deltaX);
        });

        const stopTrackDrag = (event) => {
            if (activeTrack !== track) return;

            track.classList.remove("is-dragging");

            if (track.hasPointerCapture(event.pointerId)) {
                track.releasePointerCapture(event.pointerId);
            }

            activeTrack = null;
            activeRow = null;
        };

        track.addEventListener("pointerup", stopTrackDrag);
        track.addEventListener("pointercancel", stopTrackDrag);
    });
})();

document.querySelectorAll(".big-video").forEach((section) => {
    const video = section.querySelector("video");
    const button = section.querySelector(".play-big");

    if (!video || !button) return;

    const syncPlayButton = () => {
        button.hidden = !video.paused;
    };

    button.addEventListener("click", () => {
        video.play().catch(() => {});
    });
    video.addEventListener("play", syncPlayButton);
    video.addEventListener("pause", syncPlayButton);
    video.addEventListener("ended", syncPlayButton);
});
