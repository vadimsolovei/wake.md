const {
    getCountries,
    getCountryCallingCode,
    parsePhoneNumberFromString,
} = require("libphonenumber-js/max");

const countriesByCallingCode = getCountries().reduce((map, country) => {
    const callingCode = getCountryCallingCode(country);
    const countries = map.get(callingCode) || [];

    countries.push(country);
    map.set(callingCode, countries);

    return map;
}, new Map());

const callingCodes = Array.from(countriesByCallingCode.keys()).sort(
    (a, b) => b.length - a.length,
);

const countryToFlag = (country) => {
    if (!/^[A-Z]{2}$/.test(country || "")) return "";

    return Array.from(country)
        .map((letter) =>
            String.fromCodePoint(127397 + letter.charCodeAt(0)),
        )
        .join("");
};

const normalizePhoneInput = (value) => {
    const input = String(value || "").trim();

    if (!input || input.startsWith("+")) return input;

    const digits = input.replace(/\D/g, "");

    return digits ? `+${digits}` : input;
};

const getPrefixDetails = (value) => {
    const input = normalizePhoneInput(value);

    if (!input.startsWith("+")) return null;

    const digits = input.slice(1).replace(/\D/g, "");
    const callingCode = callingCodes.find((code) => digits.startsWith(code));

    if (!callingCode) return null;

    const countries = countriesByCallingCode.get(callingCode) || [];
    const country = countries.length === 1 ? countries[0] : "";

    return {
        country,
        countryCallingCode: callingCode,
        countries,
        flag: countryToFlag(country),
    };
};

const getPhoneValidationResult = (value) => {
    const input = String(value || "").trim();
    const normalizedInput = normalizePhoneInput(input);
    const prefix = getPrefixDetails(input);
    const base = {
        valid: false,
        e164: "",
        country: prefix?.country || "",
        countryCallingCode: prefix?.countryCallingCode || "",
        flag: prefix?.flag || "",
        formatted: "",
        message: "",
    };

    if (!input) {
        return base;
    }

    const phoneNumber = parsePhoneNumberFromString(normalizedInput);

    if (!phoneNumber) {
        return {
            ...base,
            message: "Введите корректный международный номер телефона.",
        };
    }

    const country = phoneNumber.country || base.country;
    const countryCallingCode = phoneNumber.countryCallingCode || base.countryCallingCode;
    const flag = countryToFlag(country);

    if (!country || !phoneNumber.isValid()) {
        return {
            ...base,
            country,
            countryCallingCode,
            flag,
            formatted: phoneNumber.formatInternational(),
            message: "Введите корректный международный номер телефона.",
        };
    }

    return {
        valid: true,
        e164: phoneNumber.number,
        country,
        countryCallingCode,
        flag,
        formatted: phoneNumber.formatInternational(),
        message: "",
    };
};

module.exports = {
    getPhoneValidationResult,
};
