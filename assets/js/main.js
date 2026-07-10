(() => {
    const heroLayers = Array.from(document.querySelectorAll(".hero__bg"));
    const heroAssets = window.__wakeHeroAssets;

    if (heroLayers.length !== 2 || !heroAssets) return;

    const { heroIndexes, heroBaseUrl } = heroAssets;
    let currentIndex = heroAssets.selectedIndex;
    let activeLayerIndex = 0;
    let rotationTimer;

    const isOverlayOpen = () =>
        document.documentElement.classList.contains("has-booking-modal") ||
        document.documentElement.classList.contains("has-app-alert");

    const getAssets = (index) => ({
        desktop: new URL(
            `hero-desktop-${index}.webp`,
            heroBaseUrl,
        ).href,
        mobile: new URL(
            `hero-mobile-${index}.webp`,
            heroBaseUrl,
        ).href,
    });

    const preloadImage = (src) =>
        new Promise((resolve) => {
            const image = new Image();
            image.onload = resolve;
            image.onerror = resolve;
            image.src = src;
        });

    const scheduleRotation = () => {
        window.clearTimeout(rotationTimer);

        if (!document.hidden && !isOverlayOpen()) {
            rotationTimer = window.setTimeout(rotateHero, 5000);
        }
    };

    const rotateHero = async () => {
        const currentPosition = heroIndexes.indexOf(currentIndex);
        const nextIndex =
            heroIndexes[(currentPosition + 1) % heroIndexes.length];
        const nextAssets = getAssets(nextIndex);

        await Promise.all([
            preloadImage(nextAssets.desktop),
            preloadImage(nextAssets.mobile),
        ]);

        if (document.hidden || isOverlayOpen()) {
            scheduleRotation();
            return;
        }

        const nextLayerIndex = activeLayerIndex === 0 ? 1 : 0;
        const activeLayer = heroLayers[activeLayerIndex];
        const nextLayer = heroLayers[nextLayerIndex];

        nextLayer.style.setProperty(
            "--hero-bg-desktop",
            `url("${nextAssets.desktop}")`,
        );
        nextLayer.style.setProperty(
            "--hero-bg-mobile",
            `url("${nextAssets.mobile}")`,
        );

        window.requestAnimationFrame(() => {
            activeLayer.classList.remove("is-active");
            nextLayer.classList.add("is-active");
        });

        currentIndex = nextIndex;
        activeLayerIndex = nextLayerIndex;
        scheduleRotation();
    };

    document.addEventListener("visibilitychange", scheduleRotation);
    new MutationObserver(scheduleRotation).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
    });
    scheduleRotation();
})();

(() => {
    const lazyMediaElements = document.querySelectorAll(
        "[data-bg], [data-poster]",
    );

    if (!lazyMediaElements.length) return;

    const mobileQuery = window.matchMedia("(max-width: 767px)");

    const loadLazyMedia = (element) => {
        const desktopBackground = element.dataset.bg;
        const mobileBackground = element.dataset.bgMobile;
        const background =
            mobileQuery.matches && mobileBackground
                ? mobileBackground
                : desktopBackground;

        if (background) {
            element.style.backgroundImage = `url("${background}")`;
        }

        if (element.dataset.poster) {
            element.setAttribute("poster", element.dataset.poster);
        }

        element.classList.add("is-lazy-media-loaded");
    };

    if (!("IntersectionObserver" in window)) {
        lazyMediaElements.forEach(loadLazyMedia);
        return;
    }

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;

                loadLazyMedia(entry.target);
                observer.unobserve(entry.target);
            });
        },
        { rootMargin: "600px 0px" },
    );

    lazyMediaElements.forEach((element) => {
        observer.observe(element);
    });
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

(() => {
    try {
        const getCookie = (name) => {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2)
                return decodeURIComponent(
                    parts.pop().split(";").shift(),
                );
        };

        const setSourceCookie = (history) => {
            const date = new Date();
            date.setTime(
                date.getTime() + 60 * 24 * 60 * 60 * 1000,
            );
            const expires = "; expires=" + date.toUTCString();
            document.cookie =
                "visitor_source=" +
                encodeURIComponent(JSON.stringify(history)) +
                expires +
                "; path=/; SameSite=Lax";
        };

        const params = new URLSearchParams(window.location.search);
        const sourceFromUrl = params.get("s");
        const rawHistory = getCookie("visitor_source");

        let history = [];
        if (rawHistory) {
            try {
                history = JSON.parse(rawHistory);
                if (!Array.isArray(history)) throw new Error();
            } catch (e) {
                // Migrate old string-based cookie
                history = [{ s: rawHistory, d: new Date().toISOString() }];
            }
        }

        const now = new Date().toISOString();
        if (sourceFromUrl) {
            const lastEntry = history[history.length - 1];
            if (!lastEntry || lastEntry.s !== sourceFromUrl) {
                history.push({ s: sourceFromUrl, d: now });
            }
            setSourceCookie(history);
        } else if (history.length > 0) {
            // Extend existing cookie lifetime
            setSourceCookie(history);
        }
    } catch (e) {
        console.warn("Failed to set source cookie", e);
    }
})();
