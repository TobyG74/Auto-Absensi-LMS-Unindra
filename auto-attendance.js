const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");

moment.tz.setDefault("Asia/Jakarta");

// Muat konfigurasi
const loadConfig = () => {
    try {
        const configData = require("./config.json");
        return configData;
    } catch (error) {
        console.error("[ X ] Gagal muat config.json:", error.message);
        console.log(
            "[ ! ] Pastikan file config.json ada dan isi username sama password"
        );
        process.exit(1);
    }
};

class AutoAttendanceSystem {
    constructor() {
        this.browser = null;
        this.page = null;
        this.schedule = [];
        this.downloadPath = path.join(__dirname, "./downloads");
        this.baseDownloadPath = path.join(__dirname, "./downloads");
        this.cookiesPath = path.join(__dirname, "./cookies.json");
    }

    // Parse jadwal dari HTML dashboard
    parseScheduleFromHTML(htmlContent) {
        const schedulePattern =
            /<span>([^<]+?)\s+(\d{2}:\d{2})-(\d{2}:\d{2})\s+([^<]+?)</g;
        const schedule = [];
        let match;

        while ((match = schedulePattern.exec(htmlContent)) !== null) {
            const [, dayName, startTime, endTime, subject] = match;

            // Ganti nama hari ke bahasa Inggris
            const dayMap = {
                Senin: "Monday",
                Selasa: "Tuesday",
                Rabu: "Wednesday",
                Kamis: "Thursday",
                "Jum'at": "Friday",
                Sabtu: "Saturday",
                Minggu: "Sunday",
            };

            schedule.push({
                day: dayMap[dayName] || dayName,
                dayIndonesian: dayName,
                startTime: startTime,
                endTime: endTime,
                subject: subject.trim(),
                active: false,
            });
        }

        return schedule;
    }

    // Ambil link pertemuan dari HTML
    parseMeetingLinks(htmlContent) {
        const linkPattern =
            /<a href="([^"]*\/pertemuan\/pke\/[^"]*)"[^>]*><i class="fa fa-circle-o"><\/i>\s*<span>([^<]+)<\/span><\/a>/g;
        const links = [];
        let match;

        console.log("[ > ] Mulai parsing link pertemuan...");

        while ((match = linkPattern.exec(htmlContent)) !== null) {
            const [, url, meetingName] = match;

            const meetingNumberMatch = meetingName.match(/pertemuan\s*(\d+)/i);
            const meetingNumber = meetingNumberMatch
                ? parseInt(meetingNumberMatch[1])
                : 0;

            console.log(
                `[ > ] Ditemukan pertemuan: "${meetingName}" dengan nomor ${meetingNumber}`
            );

            links.push({
                url: url,
                name: meetingName.trim(),
                meetingNumber: meetingNumber,
                subject: this.extractSubjectFromMeetingName(meetingName),
            });
        }

        // Urutkan berdasarkan nomor pertemuan (tertinggi > terendah)
        links.sort((a, b) => b.meetingNumber - a.meetingNumber);

        console.log(
            `[ > ] Total ${links.length} pertemuan ditemukan dan diurutkan`
        );
        if (links.length > 0) {
            console.log(
                `[ > ] Pertemuan terbaru: ${links[0].name} (Nomor: ${links[0].meetingNumber})`
            );
        }

        return links;
    }

    // Helper function untuk extract nama mata kuliah dari nama pertemuan
    extractSubjectFromMeetingName(meetingName) {
        let subject = meetingName;

        subject = subject.replace(/pertemuan\s*\d+\s*[-–]?\s*/i, "");

        const patterns = [
            /([A-Z]{2,4}\s*\d*)\s*[-–]/,
            /[-–]\s*([A-Z]{2,4}\s*\d*)/,
            /^([A-Z]{2,4}\s*\d*)/,
        ];

        for (const pattern of patterns) {
            const match = subject.match(pattern);
            if (match) {
                return match[1].trim();
            }
        }

        // ambil kata pertama yang terlihat seperti kode MK
        const words = subject.split(/\s+/);
        for (const word of words) {
            if (/^[A-Z]{2,4}\d*$/.test(word)) {
                return word;
            }
        }

        // return nama asli
        return meetingName.trim();
    }

    // Muat jadwal dari halaman dashboard yang udah login
    async loadScheduleFromPage() {
        try {
            if (!this.page) {
                throw new Error("Browser belum diinisialisasi. Login dulu ya.");
            }

            console.log("[ > ] Mengambil jadwal dari dashboard...");

            // Ke halaman dashboard
            await this.page.goto("https://lms.unindra.ac.id/member", {
                waitUntil: "domcontentloaded",
                timeout: 30000,
            });

            await this.page.waitForLoadState("load");
            await this.page.waitForTimeout(2000);

            // Ambil isi HTML dari halaman
            const htmlContent = await this.page.content();

            // Ambil jadwal sama link pertemuan
            this.schedule = this.parseScheduleFromHTML(htmlContent);
            this.meetingLinks = this.parseMeetingLinks(htmlContent);

            if (this.schedule.length === 0) {
                console.log("[ ! ] Tidak ada jadwal ditemukan di dashboard");
                return false;
            }

            console.log("[ > ] Jadwal kuliah berhasil dimuat dari dashboard:");
            this.schedule.forEach((item, index) => {
                console.log(
                    `${index + 1}. ${item.dayIndonesian} ${item.startTime}-${
                        item.endTime
                    } - ${item.subject}`
                );
            });

            console.log(
                `[ ? ] Ketemu ${this.meetingLinks.length} link pertemuan`
            );

            // Debug: tampilkan semua pertemuan yang ditemukan
            if (this.meetingLinks.length > 0) {
                console.log("[ ? ] Daftar pertemuan yang ditemukan:");
                this.meetingLinks.forEach((meeting, index) => {
                    console.log(
                        `${index + 1}. ${meeting.name} (Nomor: ${
                            meeting.meetingNumber
                        }, Subject: ${meeting.subject})`
                    );
                });
            }

            return true;
        } catch (error) {
            console.error("[ X ] Gagal muat jadwal dari halaman:", error);
            return false;
        }
    }

    // Cek sekarang lagi jam kuliah apa engga (pake timezone Jakarta)
    getCurrentClass() {
        // Pake moment-timezone buat waktu Jakarta
        const now = moment.tz("Asia/Jakarta");
        const currentDay = now.format("dddd"); // Monday, Tuesday, etc.
        const currentDayIndonesian = now.locale("id").format("dddd"); // Senin, Selasa, etc.
        const currentTime = now.format("HH:mm"); // format HH:MM

        console.log(
            `[ > ] Waktu sekarang: ${currentDayIndonesian} ${currentTime} (WIB)`
        );
        console.log(`[ ~ ] Timezone: ${now.format("Z")} (${now.format("z")})`);
        console.log(`[ ! ] Hari buat matching: ${currentDay}`);

        const activeClasses = this.schedule.filter((item) => {
            console.log(
                `[ ? ] Ngecek: ${item.day} vs ${currentDay} - ${item.subject}`
            );
            if (item.day !== currentDay) return false;

            // Ubah waktu ke menit buat bandingin
            const timeToMinutes = (timeStr) => {
                const [hours, minutes] = timeStr.split(":").map(Number);
                return hours * 60 + minutes;
            };

            const currentMinutes = timeToMinutes(currentTime);
            const startMinutes = timeToMinutes(item.startTime);
            const endMinutes = timeToMinutes(item.endTime);

            // Kasih toleransi 15 menit sebelum sama sesudah jadwal
            const tolerance = 15;
            const isActiveTime =
                currentMinutes >= startMinutes - tolerance &&
                currentMinutes <= endMinutes + tolerance;

            console.log(
                `[ > ] Cek waktu: ${currentTime} (${currentMinutes}) vs ${item.startTime}-${item.endTime} (${startMinutes}-${endMinutes}) dengan toleransi ±${tolerance} = ${isActiveTime}`
            );

            return isActiveTime;
        });

        if (activeClasses.length > 0) {
            console.log(`[ X ] Ketemu ${activeClasses.length} kelas aktif`);
        } else {
            console.log(`[ ! ] Ngga ada kelas aktif sekarang`);
        }

        return activeClasses;
    }

    // Konfigurasi browser pake stealth mode
    getBrowserConfig(headless = true) {
        const config = {
            headless: headless,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--disable-web-security",
                "--disable-features=VizDisplayCompositor",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--disable-features=TranslateUI",
                "--disable-ipc-flooding-protection",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
                "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            ],
        };

        if (headless) {
            // Config tambahan buat mode headless
            config.args.push(
                "--disable-extensions-http-throttling",
                "--disable-component-extensions-with-background-pages",
                "--disable-default-apps",
                "--mute-audio",
                "--no-default-browser-check",
                "--autoplay-policy=user-gesture-required",
                "--disable-background-mode"
            );
        }

        return config;
    }

    // Setup stealth mode biar ngga kedeteksi
    async setupStealthMode(page) {
        // Hapus webdriver property
        await page.addInitScript(() => {
            Object.defineProperty(navigator, "webdriver", {
                get: () => undefined,
            });

            // Bikin chrome object palsu
            window.chrome = {
                runtime: {},
                loadTimes: function () {},
                csi: function () {},
                app: {},
            };

            // Bikin plugins palsu
            Object.defineProperty(navigator, "plugins", {
                get: () => [1, 2, 3, 4, 5],
            });

            // Bikin languages palsu
            Object.defineProperty(navigator, "languages", {
                get: () => ["id-ID", "id"],
            });

            // Bikin permissions palsu
            const originalQuery = window.navigator.permissions.query;
            return (window.navigator.permissions.query = (parameters) =>
                parameters.name === "notifications"
                    ? Promise.resolve({ state: Notification.permission })
                    : originalQuery(parameters));
        });

        // Set ukuran layar standar
        await page.setViewportSize({ width: 1920, height: 1080 });

        // Gerakin mouse secara random
        await page.mouse.move(Math.random() * 100, Math.random() * 100);
    }

    // Inisialisasi browser buat scraping pake cookie headers
    async initBrowser(headless = true, useCookieHeaders = true) {
        console.log("[ > ] Inisialisasi browser...");

        const browserConfig = this.getBrowserConfig(headless);
        this.browser = await chromium.launch(browserConfig);

        const config = loadConfig();
        const username = config.username;
        const password = config.password;

        // Siapkan cookie headers kalo ada
        let cookieHeaders = {};
        if (useCookieHeaders) {
            const cookieString = await this.getCookieString();
            if (cookieString) {
                cookieHeaders.Cookie = cookieString;
                console.log(
                    "[ ~ ] Pake cookie headers yang udah ada buat bypass CAPTCHA"
                );
                console.log(
                    `[ ? ] Jumlah cookie: ${
                        cookieString.split(";").length
                    } cookies dimuat`
                );
            } else {
                // Bikin cookie headers default buat login pertama kali
                cookieHeaders.Cookie = `colek_member_username=${username}; colek_member_pswd=${password}; colek_member_remember=true`;
                console.log("[ ~ ] Pake cookie headers default buat login");
            }
        }

        const context = await this.browser.newContext({
            userAgent:
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport: { width: 1920, height: 1080 },
            locale: "id-ID",
            timezoneId: "Asia/Jakarta",
            permissions: ["notifications"],
            extraHTTPHeaders: {
                "Accept-Language": "id-ID,id;q=0.9",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
                "Cache-Control": "max-age=0",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
                Referer: "https://lms.unindra.ac.id/",
                ...cookieHeaders,
            },
        });

        this.page = await context.newPage();

        // Setup mode siluman
        await this.setupStealthMode(this.page);

        // Bikin folder download
        try {
            await fs.mkdirSync(this.downloadPath, { recursive: true });
        } catch (error) {
            // Folder udah ada
        }

        return this;
    }

    // Ambil cookies dari file
    async getCookies() {
        try {
            if (fs.existsSync(this.cookiesPath)) {
                const cookiesString = fs.readFileSync(this.cookiesPath, "utf8");
                const cookies = JSON.parse(cookiesString);
                return cookies
                    .map((cookie) => `${cookie.name}=${cookie.value}`)
                    .join("; ");
            }
        } catch (error) {
            console.log("[ ! ] Gagal baca cookies:", error.message);
        }
        return "";
    }

    // Ambil cookie string buat headers
    async getCookieString() {
        try {
            if (fs.existsSync(this.cookiesPath)) {
                const cookiesString = fs.readFileSync(this.cookiesPath, "utf8");
                const cookies = JSON.parse(cookiesString);

                // Filter cuma cookies penting buat bypass login
                const essentialCookies = cookies.filter(
                    (cookie) =>
                        cookie.name.includes("session") ||
                        cookie.name.includes("login") ||
                        cookie.name.includes("auth") ||
                        cookie.name.includes("token") ||
                        cookie.name.includes("colek") ||
                        cookie.domain.includes("lms.unindra.ac.id")
                );

                if (essentialCookies.length > 0) {
                    return essentialCookies
                        .map((cookie) => `${cookie.name}=${cookie.value}`)
                        .join("; ");
                } else {
                    // Fallback ke semua cookies kalo ngga ada cookies penting
                    return cookies
                        .map((cookie) => `${cookie.name}=${cookie.value}`)
                        .join("; ");
                }
            }
        } catch (error) {
            console.log("[ ! ] Gagal baca cookie string:", error.message);
        }
        return "";
    }

    // Muat cookies ke context
    async loadCookies(context) {
        try {
            if (fs.existsSync(this.cookiesPath)) {
                const cookiesString = fs.readFileSync(this.cookiesPath, "utf8");
                const cookies = JSON.parse(cookiesString);
                await context.addCookies(cookies);
                console.log("[ ~ ] Cookies berhasil dimuat");
                return true;
            }
        } catch (error) {
            console.log("[ ! ] Gagal muat cookies:", error.message);
        }
        return false;
    }

    // Cek udah login belum pake cookies
    async checkLoginStatus() {
        try {
            await this.page.goto("https://lms.unindra.ac.id/member", {
                waitUntil: "domcontentloaded",
                timeout: 30000,
            });

            await this.page.waitForLoadState("load");
            await this.page.waitForTimeout(2000);

            // Cek kalo diarahin ke halaman login
            const currentUrl = this.page.url();
            if (currentUrl.includes("login")) {
                console.log("[ ~ ] Cookies udah expired, harus login lagi");
                return false;
            }

            // Cek ada elemen dashboard ngga
            const isDashboard = await this.page
                .locator("text=Dashboard")
                .isVisible({ timeout: 5000 })
                .catch(() => false);
            if (isDashboard) {
                console.log("[ X ] Udah login pake cookies");
                return true;
            }

            return false;
        } catch (error) {
            console.log("[ ! ] Gagal cek status login:", error.message);
            return false;
        }
    }

    // Login pake berbagai strategi dengan fallback
    async loginWithFallback(username, password, maxRetries = 3) {
        let attempt = 0;

        while (attempt < maxRetries) {
            attempt++;

            let useHeadless = true;
            let useCookieHeaders = true;

            // Percobaan 1: Cookie headers bypass (headless)
            if (attempt === 1) {
                useHeadless = true;
                useCookieHeaders = true;
                console.log(
                    `[ ~ ] Percobaan login ${attempt}/${maxRetries} (headless + bypass cookie headers)`
                );
                // Percobaan 2: Normal headless login
            } else if (attempt === 2) {
                useHeadless = true;
                useCookieHeaders = false;
                console.log(
                    `[ ~ ] Percobaan login ${attempt}/${maxRetries} (headless normal)`
                );
                // Percobaan 3: Non-headless manual CAPTCHA
            } else {
                useHeadless = false;
                useCookieHeaders = false;
                console.log(
                    `[ ~ ] Percobaan login ${attempt}/${maxRetries} (non-headless manual)`
                );
            }

            try {
                // Close existing browser if any
                if (this.browser) {
                    await this.browser.close();
                }

                // Initialize browser with appropriate mode
                await this.initBrowser(useHeadless, useCookieHeaders);

                // Load cookies first (if not using cookie headers)
                if (!useCookieHeaders) {
                    const cookiesLoaded = await this.loadCookies(
                        this.page.context()
                    );

                    if (cookiesLoaded) {
                        // Try to use existing cookies
                        const loginSuccess = await this.checkLoginStatus();
                        if (loginSuccess) {
                            console.log("[ X ] Udah login pake cookies!");
                            return true;
                        } else {
                            console.log(
                                "[ ! ] Cookies expired atau tidak valid"
                            );
                        }
                    } else {
                        console.log("[ ? ] Ngga ada cookies valid yang ketemu");
                    }
                }

                // Perform login
                const loginResult = await this.login(
                    username,
                    password,
                    useCookieHeaders
                );
                if (loginResult) {
                    console.log("[ X ] Login berhasil!");
                    return true;
                }
            } catch (error) {
                console.log(
                    `[ X ] Percobaan login ${attempt} gagal:`,
                    error.message
                );
            }

            if (attempt < maxRetries) {
                console.log("[ ~ ] Nyoba lagi pake strategi lain...");
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
        }

        console.log("[ X ] Semua percobaan login gagal");
        return false;
    }

    // Login ke LMS dengan enhanced CAPTCHA handling dan cookie headers bypass
    async login(username, password, useCookieHeaders = false) {
        try {
            console.log("[ > ] Lagi login ke LMS...");

            if (useCookieHeaders) {
                console.log("[ ~ ] Pake strategi bypass cookie headers");

                // Coba akses langsung ke halaman member
                try {
                    await this.page.goto("https://lms.unindra.ac.id/member", {
                        waitUntil: "domcontentloaded",
                        timeout: 15000,
                    });

                    await this.page.waitForLoadState("load");
                    await this.page.waitForTimeout(2000);

                    // Cek kalo diarahin ke halaman member
                    const currentUrl = this.page.url();
                    if (
                        currentUrl.includes("member") &&
                        !currentUrl.includes("login")
                    ) {
                        console.log(
                            "[ > ] Login berhasil pake bypass cookie headers!"
                        );
                        return true;
                    }
                } catch (error) {
                    console.log(
                        "[ ! ] Bypass cookie headers gagal, lanjut pake login normal"
                    );
                }
            }

            // Normal login process
            await this.page.goto("https://lms.unindra.ac.id/login_new", {
                waitUntil: "domcontentloaded",
                timeout: 30000,
            });

            await this.page.waitForLoadState("load");
            await this.page.waitForTimeout(2000);

            // Fill login form
            await this.page.fill('input[name="username"]', username);
            await this.page.waitForTimeout(1000);
            await this.page.fill('input[name="pswd"]', password);
            await this.page.waitForTimeout(1000);

            // Handle reCAPTCHA kalo ada
            let captchaSolved = false;
            try {
                // Tunggu iframe reCAPTCHA muncul
                await this.page.waitForSelector(
                    'iframe[src*="recaptcha/api2/anchor"]',
                    { timeout: 5000 }
                );

                const recaptchaFrame = this.page.frameLocator(
                    'iframe[src*="recaptcha/api2/anchor"]'
                );
                const checkbox = recaptchaFrame.locator("#recaptcha-anchor");

                if (await checkbox.isVisible({ timeout: 3000 })) {
                    console.log("[ ~ ] Solving reCAPTCHA...");

                    // Add random delay to mimic human behavior
                    await this.page.waitForTimeout(Math.random() * 2000 + 1000);

                    // Gerakin mouse ke checkbox
                    await this.page.mouse.move(
                        Math.random() * 200 + 100,
                        Math.random() * 200 + 100
                    );
                    await this.page.waitForTimeout(500);

                    await checkbox.click();

                    // Tunggu CAPTCHA diproses dengan timeout yang lebih lama
                    await this.page.waitForTimeout(5000);

                    // Cek kalo checkbox udah dicentang
                    const isChecked = await checkbox
                        .isChecked()
                        .catch(() => false);
                    if (isChecked) {
                        console.log("[ > ] reCAPTCHA berhasil dipecahin");
                        captchaSolved = true;
                    } else {
                        // Cek kalo muncul tantangan gambar
                        const challengeFrame = this.page.locator(
                            'iframe[src*="recaptcha/api2/bframe"]'
                        );
                        if (await challengeFrame.isVisible({ timeout: 2000 })) {
                            console.log(
                                "🧩 Image CAPTCHA detected - requires manual solving"
                            );
                            if (
                                !this.browser.isConnected() ||
                                this.page.isClosed()
                            ) {
                                throw new Error(
                                    "Browser needs to be in non-headless mode for manual CAPTCHA solving"
                                );
                            }

                            // Nunggu waktu user buat solve CAPTCHA secara manual
                            console.log(
                                "⏳ Waiting for manual CAPTCHA solving... (60 seconds timeout)"
                            );
                            await this.page.waitForTimeout(60000);
                            captchaSolved = true; // Assume user solved it
                        }
                    }
                }
            } catch (captchaError) {
                console.log(
                    "[ ? ] Ngga ada reCAPTCHA atau auto-solve gagal:",
                    captchaError.message
                );
                captchaSolved = true; // Continue tanpa CAPTCHA
            }

            // Submit form
            console.log("[ > ] Submitting login form...");
            const submitButton = this.page
                .locator('button[type="submit"], input[type="submit"]')
                .first();
            await submitButton.click();

            // Wait for navigation
            await Promise.race([
                this.page.waitForLoadState("domcontentloaded"),
                this.page.waitForURL("**/member*", { timeout: 15000 }),
                this.page.waitForTimeout(10000),
            ]);

            const currentUrl = this.page.url();
            console.log(`[ ? ] Current URL after login: ${currentUrl}`);

            if (
                currentUrl.includes("member") ||
                currentUrl.includes("dashboard") ||
                !currentUrl.includes("login")
            ) {
                console.log("[ X ] Login successful!");

                // Save cookies untuk sesi berikutnya
                const cookies = await this.page.context().cookies();
                await fs.writeFileSync(
                    this.cookiesPath,
                    JSON.stringify(cookies, null, 2)
                );
                console.log("[ > ] Saved cookies to cookies.json");

                return true;
            } else {
                // Cek pesan error di halaman
                const errorMessage = await this.page
                    .locator(".alert-danger, .error, .login-error")
                    .textContent()
                    .catch(() => "");
                if (errorMessage) {
                    console.log(`[ X ] Login gagal: ${errorMessage}`);
                } else {
                    console.log("[ X ] Login gagal - masih di halaman login");
                }
                return false;
            }
        } catch (error) {
            console.error("[ X ] Login error:", error.message);
            return false;
        }
    }

    // Download materi dari URL pertemuan
    async downloadMaterials(meetingUrl, className, meetingName) {
        try {
            console.log(`[ > ] Downloading materials from: ${meetingName}`);

            await this.page.goto(meetingUrl, {
                waitUntil: "domcontentloaded",
                timeout: 30000,
            });

            await this.page.waitForLoadState("load");
            await this.page.waitForTimeout(3000);

            // Bikin folder buat kelas dan pertemuan
            const classFolder = path.join(
                this.downloadPath,
                className.replace(/[^\w\s]/gi, "_")
            );
            const meetingFolder = path.join(
                classFolder,
                meetingName.replace(/[^\w\s]/gi, "_")
            );

            try {
                await fs.mkdirSync(meetingFolder, { recursive: true });
                console.log(`[ > ] Created folder: ${meetingFolder}`);
            } catch (error) {
                console.log(`[ > ] Folder already exists: ${meetingFolder}`);
            }

            let downloadCount = 0;

            // Percobaan 1: Cari link langsung ke file
            console.log(
                "[ ? ] Percobaan 1: Looking for direct download links..."
            );
            const downloadLinks = await this.page
                .locator(
                    'a[href*="download"], a[href*=".pdf"], a[href*=".ppt"], a[href*=".pptx"], a[href*=".doc"], a[href*=".docx"], a[href*=".zip"], a[href*=".rar"], a[href*=".xlsx"], a[href*=".xls"]'
                )
                .all();

            for (const link of downloadLinks) {
                try {
                    const href = await link.getAttribute("href");
                    const text = await link.textContent();

                    if (href && this.isDownloadableFile(href)) {
                        console.log(
                            `[ > ] Downloading: ${text?.trim() || "file"}`
                        );

                        const success = await this.downloadFile(
                            link,
                            meetingFolder,
                            text?.trim() || "file"
                        );
                        if (success) downloadCount++;

                        await this.page.waitForTimeout(1500);
                    }
                } catch (linkError) {
                    console.log(
                        `[ ! ] Error proses link: ${linkError.message}`
                    );
                }
            }

            // Percobaan 2: Cari link dengan force_download
            console.log(
                "[ ? ] Percobaan 2: Looking for force_download links..."
            );
            const forceDownloadLinks = await this.page
                .locator('a[onclick*="force_download"]')
                .all();

            for (const link of forceDownloadLinks) {
                try {
                    const onclick = await link.getAttribute("onclick");
                    const text = await link.textContent();

                    if (onclick) {
                        // Extract filename dari force_download call
                        const match = onclick.match(
                            /force_download\(['"]([^'"]+)['"]\)/
                        );
                        if (match) {
                            const filename = match[1];
                            console.log(
                                `[ > ] Force downloading: ${
                                    text?.trim() || filename
                                }`
                            );

                            const success = await this.forceDownloadFile(
                                filename,
                                meetingFolder,
                                text?.trim() || filename
                            );
                            if (success) downloadCount++;

                            await this.page.waitForTimeout(1500);
                        }
                    }
                } catch (linkError) {
                    console.log(
                        `[ ! ] Error proses force download: ${linkError.message}`
                    );
                }
            }

            // Percobaan 3: Cari file embedded (iframe, embed, object)
            console.log("[ ? ] Percobaan 3: Looking for embedded files...");
            const embeddedFiles = await this.page
                .locator(
                    'iframe[src*=".pdf"], embed[src*=".pdf"], object[data*=".pdf"]'
                )
                .all();

            for (const embed of embeddedFiles) {
                try {
                    const src =
                        (await embed.getAttribute("src")) ||
                        (await embed.getAttribute("data"));

                    if (src && src.includes(".pdf")) {
                        console.log(`[ > ] Downloading embedded PDF: ${src}`);

                        const success = await this.downloadEmbeddedFile(
                            src,
                            meetingFolder
                        );
                        if (success) downloadCount++;

                        await this.page.waitForTimeout(1500);
                    }
                } catch (embedError) {
                    console.log(
                        `[ ! ] Error proses embedded file: ${embedError.message}`
                    );
                }
            }

            // Percobaan 4: Cari link di konten materi
            console.log(
                "[ ? ] Percobaan 4: Looking for material links in content..."
            );
            const contentLinks = await this.page
                .locator(".content a, .materi a, .material a, .download a")
                .all();

            for (const link of contentLinks) {
                try {
                    const href = await link.getAttribute("href");
                    const text = await link.textContent();

                    if (
                        href &&
                        this.isDownloadableFile(href) &&
                        !href.includes("javascript:")
                    ) {
                        console.log(
                            `[ > ] Downloading content link: ${
                                text?.trim() || "content_file"
                            }`
                        );

                        const success = await this.downloadFile(
                            link,
                            meetingFolder,
                            text?.trim() || "content_file"
                        );
                        if (success) downloadCount++;

                        await this.page.waitForTimeout(1500);
                    }
                } catch (linkError) {
                    console.log(
                        `[ ! ] Error proses content link: ${linkError.message}`
                    );
                }
            }

            // Percobaan 5: Kalo ngga ada yang ke-download, ambil screenshot + HTML
            if (downloadCount === 0) {
                console.log(
                    "[ ? ] No downloadable materials found, taking screenshot and saving page content..."
                );

                // Take screenshot
                const screenshotPath = path.join(
                    meetingFolder,
                    `${meetingName}_screenshot.png`
                );
                await this.page.screenshot({
                    path: screenshotPath,
                    fullPage: true,
                });
                console.log(`[ > ] Screenshot saved: ${screenshotPath}`);

                // Save page HTML
                const htmlContent = await this.page.content();
                const htmlPath = path.join(
                    meetingFolder,
                    `${meetingName}_content.html`
                );
                await fs.writeFileSync(htmlPath, htmlContent, "utf8");
                console.log(`[ > ] Page content saved: ${htmlPath}`);

                downloadCount = 2; // Screenshot + HTML
            }

            // Save summary file
            await this.saveSummaryFile(
                meetingFolder,
                className,
                meetingName,
                downloadCount
            );

            console.log(
                `[ > ] Absensi untuk ${className} - ${meetingName} berhasil! (${downloadCount} items saved)`
            );
            return downloadCount > 0;
        } catch (error) {
            console.error(`[ X ] Error downloading materials: ${error}`);
            return false;
        }
    }

    // Cek kalo URL itu file yang bisa didownload
    isDownloadableFile(url) {
        const downloadableExtensions = [
            ".pdf",
            ".doc",
            ".docx",
            ".ppt",
            ".pptx",
            ".xls",
            ".xlsx",
            ".zip",
            ".rar",
            ".7z",
            ".txt",
            ".rtf",
            ".png",
            ".jpg",
            ".jpeg",
        ];

        return downloadableExtensions.some(
            (ext) =>
                url.toLowerCase().includes(ext) ||
                url.toLowerCase().includes("download")
        );
    }

    // Download file menggunakan event download Playwright
    async downloadFile(linkElement, targetFolder, linkText) {
        try {
            const downloadPromise = this.page.waitForEvent("download", {
                timeout: 15000,
            });
            await linkElement.click();

            const download = await downloadPromise;
            const originalFilename =
                download.suggestedFilename() || "unknown_file";
            const safeLinkText = linkText
                .replace(/[^\w\s\.-]/gi, "_")
                .substring(0, 50);
            const filename = `${safeLinkText}_${originalFilename}`;
            const downloadPath = path.join(targetFolder, filename);

            await download.saveAs(downloadPath);
            console.log(`[ > ] Downloaded: ${filename}`);
            return true;
        } catch (downloadError) {
            console.log(`[ ! ] Download gagal: ${downloadError.message}`);
            return false;
        }
    }

    // Force download file dari URL khusus
    async forceDownloadFile(filename, targetFolder, linkText) {
        try {
            const downloadUrl = `https://lms.unindra.ac.id/media_public/force_download/${filename}`;
            console.log(`[ ? ] Force download URL: ${downloadUrl}`);

            const newPage = await this.page.context().newPage();

            const downloadPromise = newPage.waitForEvent("download", {
                timeout: 15000,
            });
            await newPage.goto(downloadUrl);

            const download = await downloadPromise;
            const originalFilename = download.suggestedFilename() || filename;
            const safeLinkText = linkText
                .replace(/[^\w\s\.-]/gi, "_")
                .substring(0, 50);
            const finalFilename = `${safeLinkText}_${originalFilename}`;
            const downloadPath = path.join(targetFolder, finalFilename);

            await download.saveAs(downloadPath);
            await newPage.close();

            console.log(`[ > ] Force downloaded: ${finalFilename}`);
            return true;
        } catch (downloadError) {
            console.log(
                `[ ! ] Force download failed: ${downloadError.message}`
            );
            return false;
        }
    }

    // Download embedded file
    async downloadEmbeddedFile(fileUrl, targetFolder) {
        try {
            // Make URL absolute if relative
            let absoluteUrl = fileUrl;
            if (fileUrl.startsWith("/")) {
                absoluteUrl = `https://lms.unindra.ac.id${fileUrl}`;
            } else if (fileUrl.startsWith("..")) {
                absoluteUrl = `https://lms.unindra.ac.id/${fileUrl}`;
            }

            const newPage = await this.page.context().newPage();

            const downloadPromise = newPage.waitForEvent("download", {
                timeout: 15000,
            });
            await newPage.goto(absoluteUrl);

            const download = await downloadPromise;
            const filename =
                download.suggestedFilename() || `embedded_${Date.now()}.pdf`;
            const downloadPath = path.join(targetFolder, filename);

            await download.saveAs(downloadPath);
            await newPage.close();

            console.log(`[ > ] Embedded file downloaded: ${filename}`);
            return true;
        } catch (downloadError) {
            console.log(
                `[ ! ] Embedded download failed: ${downloadError.message}`
            );
            return false;
        }
    }

    // Save summary file dengan timezone Jakarta
    async saveSummaryFile(targetFolder, className, meetingName, downloadCount) {
        try {
            const jakartaTime = moment.tz("Asia/Jakarta");
            const summary = {
                className: className,
                meetingName: meetingName,
                downloadDate: jakartaTime.format(),
                downloadDateISO: jakartaTime.toISOString(),
                downloadDateReadable: jakartaTime.format(
                    "DD MMMM YYYY HH:mm:ss"
                ),
                timezone: "Asia/Jakarta",
                downloadCount: downloadCount,
                folder: targetFolder,
                status: downloadCount > 0 ? "SUCCESS" : "NO_FILES",
            };

            const summaryPath = path.join(
                targetFolder,
                "download_summary.json"
            );
            await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
        } catch (error) {
            console.log(`[ ! ] Error saving summary: ${error.message}`);
        }
    }

    // Proses absensi otomatis
    async processAttendance(activeClass) {
        try {
            console.log(`[ > ] Proses absensi untuk: ${activeClass.subject}`);

            // Cari link pertemuan yang relevan untuk mata kuliah
            const relevantMeetings = this.meetingLinks.filter((link) => {
                if (!link.url || link.url.length === 0) return false;

                // Cek apakah nama pertemuan mengandung subject dari activeClass
                const meetingSubject = link.subject.toLowerCase();
                const classSubject = activeClass.subject.toLowerCase();

                // Coba berbagai cara matching
                const isMatch =
                    meetingSubject.includes(classSubject) ||
                    classSubject.includes(meetingSubject) ||
                    link.name.toLowerCase().includes(classSubject) ||
                    classSubject.includes(
                        link.name.toLowerCase().split(" ")[0]
                    );

                if (isMatch) {
                    console.log(
                        `[ > ] Match: "${link.name}" cocok dengan "${activeClass.subject}" (Nomor: ${link.meetingNumber})`
                    );
                }

                return isMatch;
            });

            console.log(
                `[ ? ] Ketemu ${relevantMeetings.length} pertemuan untuk ${activeClass.subject}`
            );

            // Debug: tampilkan semua pertemuan yang tersedia
            if (relevantMeetings.length === 0 && this.meetingLinks.length > 0) {
                console.log("[ ? ] Pertemuan yang tersedia:");
                this.meetingLinks.forEach((link) => {
                    console.log(
                        `   - ${link.name} (Subject: "${link.subject}", Nomor: ${link.meetingNumber})`
                    );
                });
            }

            if (relevantMeetings.length === 0) {
                console.log(
                    `[ ! ] Ngga ada pertemuan yang cocok untuk ${activeClass.subject}`
                );

                // Fallback: ambil pertemuan terbaru dari semua pertemuan
                const allMeetings = this.meetingLinks.filter(
                    (link) => link.url && link.url.length > 0
                );
                if (allMeetings.length > 0) {
                    console.log(
                        `[ ? ] Fallback: pake pertemuan terbaru dari semua pertemuan`
                    );
                    const latestMeeting = allMeetings[0]; // Sudah diurutkan dari terbaru

                    const success = await this.downloadMaterials(
                        latestMeeting.url,
                        activeClass.subject,
                        latestMeeting.name
                    );

                    if (success) {
                        await this.logAttendanceSuccess(
                            activeClass,
                            latestMeeting
                        );
                    }
                    return success;
                }
                return false;
            }

            // Ambil pertemuan terbaru (nomor tertinggi) dari yang relevan
            const latestMeeting = relevantMeetings[0]; // Sudah diurutkan dari terbaru
            console.log(
                `[ > ] Pake pertemuan terbaru: ${latestMeeting.name} (Nomor: ${latestMeeting.meetingNumber})`
            );

            const success = await this.downloadMaterials(
                latestMeeting.url,
                activeClass.subject,
                latestMeeting.name
            );

            if (success) {
                await this.logAttendanceSuccess(activeClass, latestMeeting);
            }

            return success;
        } catch (error) {
            console.error(`[ X ] Error proses absensi: ${error}`);
            return false;
        }
    }

    // Helper function untuk log attendance yang berhasil
    async logAttendanceSuccess(activeClass, meeting) {
        const attendanceLog = {
            timestamp: moment.tz("Asia/Jakarta").format(),
            timestampISO: moment.tz("Asia/Jakarta").toISOString(),
            class: activeClass.subject,
            day: activeClass.dayIndonesian,
            time: `${activeClass.startTime}-${activeClass.endTime}`,
            meeting: meeting.name,
            meetingNumber: meeting.meetingNumber,
            status: "SUCCESS",
        };

        await this.logAttendance(attendanceLog);
    }

    // Log attendance ke file
    async logAttendance(attendanceData) {
        try {
            const logFile = "./attendance_log.json";
            let logs = [];

            try {
                const existingLogs = await fs.readFile(logFile, "utf8");
                logs = JSON.parse(existingLogs);
            } catch (error) {
                // File doesn't exist, start with empty array
            }

            logs.push(attendanceData);
            await fs.writeFile(logFile, JSON.stringify(logs, null, 2));

            console.log("[ > ] Attendance logged successfully");
        } catch (error) {
            console.error("[ X ] Error logging attendance:", error);
        }
    }

    // Main function untuk check dan proses absensi dengan enhanced retry system
    async checkAndProcessAttendance(username, password) {
        try {
            console.log("[ > ] Starting attendance check process...");

            // Try login with fallback system
            const loginSuccess = await this.loginWithFallback(
                username,
                password
            );
            if (!loginSuccess) {
                throw new Error("Login gagal setelah semua percobaan");
            }

            // Load schedule dari halaman dashboard setelah login
            console.log("[ > ] Loading schedule from dashboard...");
            if (!(await this.loadScheduleFromPage())) {
                throw new Error("Gagal muat jadwal dari dashboard");
            }

            // Check current time
            const activeClasses = this.getCurrentClass();

            if (activeClasses.length === 0) {
                console.log("[ ? ] Tidak ada kelas yang aktif saat ini");
                return false;
            }

            console.log(`[ > ] Found ${activeClasses.length} active classes:`);
            activeClasses.forEach((cls) => {
                console.log(
                    `   - ${cls.subject} (${cls.startTime}-${cls.endTime})`
                );
            });

            // Process each active class
            let totalSuccess = 0;
            for (const activeClass of activeClasses) {
                console.log(`\n[ > ] Proses: ${activeClass.subject}`);
                const success = await this.processAttendance(activeClass);
                if (success) {
                    totalSuccess++;
                    console.log(`[ > ] Success: ${activeClass.subject}`);
                } else {
                    console.log(`[ X ] Failed: ${activeClass.subject}`);
                }

                // Wait between classes
                await this.page.waitForTimeout(2000);
            }

            console.log(`\n[ ! ] Attendance process completed!`);
            console.log(
                `[ ? ] Hasil: ${totalSuccess}/${activeClasses.length} kelas berhasil diproses`
            );

            return totalSuccess > 0;
        } catch (error) {
            console.error("[ X ] Error in attendance process:", error.message);
            return false;
        } finally {
            if (this.browser) {
                console.log("[ > ] Closing browser...");
                await this.browser.close();
            }
        }
    }

    // Cleanup
    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }
}

module.exports = AutoAttendanceSystem;
