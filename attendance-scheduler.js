const AutoAttendanceSystem = require("./auto-attendance");
const cron = require("node-cron");
const moment = require("moment-timezone");

moment.tz.setDefault("Asia/Jakarta");

// Config argv untuk menangkap opsi command line
const { argv } = require("process");

// Parse command line arguments
const parseArguments = () => {
    const args = {
        manualCaptcha: false,
        headless: true,
        useCookieHeaders: true,
    };

    // Check for manual captcha flag
    if (argv.includes("--manual-captcha") || argv.includes("-m")) {
        args.manualCaptcha = true;
        args.headless = false;
        console.log("[ > ] Mode manual CAPTCHA aktif");
    }

    // Check for headless flag
    if (argv.includes("--no-headless") || argv.includes("-nh")) {
        args.headless = false;
        console.log("[ > ] Mode non-headless aktif");
    }

    // Check for disable cookie headers flag
    if (argv.includes("--no-cookie-headers") || argv.includes("-nch")) {
        args.useCookieHeaders = false;
        console.log("[ X ] Bypass cookie headers dimatiin");
    }

    return args;
};

// Load configuration
const loadConfig = () => {
    try {
        const configData = require("./config.json");
        if (
            !configData.username ||
            !configData.password ||
            configData.username === "your_username" ||
            configData.password === "your_password"
        ) {
            throw new Error(
                "Akun default terdeteksi. Silakan perbarui config.json dulu!"
            );
        }
        return configData;
    } catch (error) {
        console.error("[ X ] Gagal memuat config.json:", error.message);
        console.log(
            "[ ! ] Pastikan config.json ada pakai username dan password valid!"
        );
        process.exit(1);
    }
};

class AttendanceScheduler {
    constructor() {
        const config = loadConfig();
        this.username = config.username;
        this.password = config.password;
        this.autoAttendance = new AutoAttendanceSystem();
        this.isRunning = false;
        this.args = parseArguments();

        console.log(
            `[ > ] Scheduler diinisialisasi untuk pengguna: ${this.username}`
        );
        if (this.args.manualCaptcha) {
            console.log("[ > ] Mode: Manual CAPTCHA (non-headless)");
        } else {
            console.log("[ ~ ] Mode: Auto CAPTCHA (dengan fallback ke manual)");
        }

        if (this.args.useCookieHeaders) {
            console.log("[ ~ ] Cookie headers bypass: Aktif");
        } else {
            console.log("[ X ] Cookie headers bypass: Dimatiin");
        }
    }

    // Mulai jadwal pengecekan absensi
    startScheduler() {
        console.log("[ > ] Memulai Scheduler Absensi Otomatis...");
        console.log(
            "[ ! ] Akan mengecek kelas setiap 30 menit selama perkuliahan"
        );

        // Always jalan setiap 30 menit dari jam 7:00 sampai 18:00 pada perkuliahan
        const schedule = "*/30 7-18 * * 1-5";

        this.cronJob = cron.schedule(
            schedule,
            async () => {
                if (this.isRunning) {
                    console.log(
                        "[ ! ] Pengecekan absensi sebelumnya masih berjalan, diskip..."
                    );
                    return;
                }

                this.isRunning = true;
                const currentTime = moment.tz("Asia/Jakarta");
                console.log(`\n[ > ] Scheduler absensi terjadwal dimulai...`);
                console.log(
                    `[ ! ] Waktu eksekusi: ${currentTime.format(
                        "DD MMMM YYYY HH:mm:ss"
                    )} WIB`
                );

                try {
                    await this.autoAttendance.checkAndProcessAttendance(
                        this.username,
                        this.password
                    );
                } catch (error) {
                    console.error(
                        "[ X ] Scheduler absensi terjadwal gagal:",
                        error
                    );
                } finally {
                    this.isRunning = false;
                }
            },
            {
                scheduled: true,
                timezone: "Asia/Jakarta",
            }
        );

        console.log("[ > ] Scheduler absensi berhasil dimulai!");
        console.log("[ > ] Jadwal: Setiap 30 menit, 7:00-18:00, Senin-Jumat");

        this.runImmediateCheck();
    }

    // Jalanin pemeriksaan absensi
    async runImmediateCheck() {
        console.log("\n[ ? ] Otw Jalanin pengecekan absensi ~~~");

        if (this.isRunning) {
            console.log("[ ! ] Pengecekan absensi lagi berjalan");
            return;
        }

        this.isRunning = true;
        try {
            await this.autoAttendance.checkAndProcessAttendance(
                this.username,
                this.password
            );
        } catch (error) {
            console.error("[ X ] Scheduler absensi segera gagal:", error);
        } finally {
            this.isRunning = false;
        }
    }

    // Stop pemeriksaan absensi
    stopScheduler() {
        if (this.cronJob) {
            this.cronJob.destroy();
            console.log("[ X ] Scheduler absensi dihentikan");
        }
    }

    // Get status pemeriksaan absensi
    getStatus() {
        return {
            running: this.cronJob ? this.cronJob.getStatus() : "berhenti",
            isProcessing: this.isRunning,
            nextRun: this.cronJob
                ? "Setiap 30 menit dari 7:00-18:00 perkuliahan"
                : "Tidak terjadwal",
            username: this.username,
        };
    }
}

// Usage
const main = async () => {
    if (argv.includes("--help") || argv.includes("-h")) {
        console.log(`
[ > ] Sistem Absensi Otomatis LMS Unindra
=====================================

Usage: npm start [options]

Options:
  --manual-captcha, -m      Jalankan dalam mode manual CAPTCHA (non-headless)
  --no-headless, -nh        Jalankan tanpa headless mode (untuk debugging)
  --no-cookie-headers, -nch Disable cookie headers bypass strategy
  --help, -h                Tampilkan bantuan ini

Examples:
  npm start                          # Mode normal (auto CAPTCHA dengan cookie headers bypass)
  npm start -- --manual-captcha     # Mode manual CAPTCHA
  npm start -- --no-headless        # Mode non-headless untuk debugging
  npm start -- --no-cookie-headers  # Disable cookie headers bypass

Features:
  [ > ] Cookie headers bypass untuk menghindari CAPTCHA
  [ > ] Auto bypass CAPTCHA menggunakan stealth mode
  [ > ] Fallback ke manual CAPTCHA jika diperlukan  
  [ > ] Auto load cookies untuk menghindari login berulang
  [ > ] Retry mechanism dengan berbagai strategi
  [ > ] Download materi otomatis
  [ > ] Scheduler otomatis setiap 30 menit (7:00-18:00, Senin-Jumat)
        `);
        process.exit(0);
    }

    console.log("[ > ] Sistem Absensi Otomatis LMS");
    console.log("================================");

    const scheduler = new AttendanceScheduler();

    // Start scheduler
    scheduler.startScheduler();

    // Handle graceful shutdown
    process.on("SIGINT", () => {
        console.log("\n[ X ] Berhentikan Sistem Scheduler..");
        scheduler.stopScheduler();
        process.exit(0);
    });

    process.on("SIGTERM", () => {
        console.log("\n[ X ] Berhentikan Sistem Scheduler..");
        scheduler.stopScheduler();
        process.exit(0);
    });

    // Keep process alive
    console.log("\n[ ! ] Tekan Ctrl+C untuk menghentikan scheduler");
    console.log("[ ? ] Informasi sistem:");
    console.log("   - Proses akan mengecek absensi secara otomatis");
    console.log("   - Log akan disimpan ke attendance_log.json");
    console.log("   - Download akan disimpan ke ./downloads/");
    console.log(
        "   - Mode CAPTCHA: " +
            (scheduler.args.manualCaptcha ? "Manual" : "Auto dengan fallback")
    );
    console.log(
        "   - Mode browser: " +
            (scheduler.args.headless ? "Headless" : "Non-headless")
    );
    console.log(
        "   - Cookie headers bypass: " +
            (scheduler.args.useCookieHeaders ? "Enabled" : "Disabled")
    );
    console.log("\n[ ! ] Tips:");
    console.log(
        "   - Gunakan 'npm start -- --help' untuk melihat opsi lengkap"
    );
    console.log(
        "   - File cookies.json akan dibuat otomatis setelah login pertama"
    );
    console.log(
        "   - Cookie headers bypass mencoba langsung akses tanpa CAPTCHA"
    );
    console.log(
        "   - Jika CAPTCHA gagal di mode headless, sistem otomatis fallback ke manual"
    );

    // Update status setiap jam
    setInterval(() => {
        const status = scheduler.getStatus();
        const currentTime = moment.tz("Asia/Jakarta");
        console.log(
            `\n[ ? ] Update Status: ${currentTime.format(
                "DD MMMM YYYY HH:mm:ss"
            )} WIB`
        );
        console.log(`   Pengguna: ${status.username}`);
        console.log(`   Jadwal: ${status.running}`);
        console.log(
            `   Sedang Memproses: ${status.isProcessing ? "Ya" : "Tidak"}`
        );
    }, 3600000);
};

if (require.main === module) {
    main().catch(console.error);
}

module.exports = AttendanceScheduler;
