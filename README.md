# Auto Absensi LMS Unindra

Sebuah script untuk melakukan auto absensi di LMS Universitas Indraprasta PGRI (Unindra) menggunakan Playwright dan Node.js.

## Fitur

1. **Smart CAPTCHA Solving**
2. **Stealth Mode**
3. **Cookie Persistence**
4. **Auto Retry**
5. **Download Materi Otomatis**
6. **Isi Absensi Otomatis**

## Installation & Setup

## Cookies

-   Note Penting: Buat bypass captcha, kalian harus login manual di browser dengan menggunakan extension "Cookie Editor" bisa dicari di chrome web store atau firefox addons. Apabila kalian tidak mengisi file cookies.json, maka script akan gagal untuk di running karena terkena captcha.

1. Buka website [LMS Unindra](https://lms.unindra.ac.id) di browser kalian
2. Login menggunakan akun kalian, lalu klik icon extension "Cookie Editor" di pojok kanan atas browser kalian
3. Setelah itu klik "Export" ke dalam format JSON, lalu copy semua isinya
4. Buat file baru di folder project ini dengan nama `cookies.json`
5. Paste isi cookies yang sudah di copy tadi ke dalam file `cookies.json` lalu simpan

## Cara Menjalankan

1. Pastikan kalian sudah menginstall [Node.js](https://nodejs.org/en/download/) di komputer kalian
2. Clone repository ini ke komputer kalian

```bash
git clone https://github.com/TobyG74/auto-absensi-lms-unindra.git
cd auto-absensi-lms-unindra
```

3. Install dependencies yang dibutuhkan

```bash
npm install
```

4. Rename file `config.example.json` menjadi `config.json` dan isi dengan username serta password akun LMS Unindra kalian

```bash
mv config.example.json config.json
```

Contoh isi `config.json`:

```json
{
    "username": "202243501234",
    "password": "TOBZ_GANTENG"
}
```

5. Jalankan script dengan berbagai mode

**Mode Normal (Recommended)**:

```bash
npm start
```

**Mode Manual CAPTCHA** (jika auto gagal):

```bash
npm run manual
# atau
npm start -- --manual-captcha
```

**Help/Bantuan**:

```bash
npm start -- --help
```

## Mode Operasi

### 1. Auto Mode (Default)

-   Sistem akan mencoba solve CAPTCHA secara otomatis menggunakan stealth mode
-   Jika gagal, otomatis fallback ke mode manual (non-headless)
-   Menggunakan cookies untuk menghindari CAPTCHA sebisa mungkin

### 2. Manual Mode

-   Langsung buka browser non-headless
-   Ideal untuk solve CAPTCHA manual jika auto mode gagal
-   Gunakan: `npm run manual`

## Troubleshooting

### CAPTCHA Tidak Tersolve di Mode Headless

**Penyebab:**

-   Browser headless mudah dideteksi oleh sistem anti-bot
-   reCAPTCHA menggunakan behavioral analysis

**Solusi Otomatis:**

1. Sistem sudah implementasi stealth mode untuk menghindari deteksi
2. Auto fallback ke mode non-headless jika headless gagal
3. Enhanced cookie system untuk skip CAPTCHA

**Solusi Manual:**

```bash
# Jalankan langsung dalam mode manual
npm run manual
```

### Cookies Expired

Jika cookies expired, sistem akan otomatis:

1. Deteksi cookies tidak valid
2. Perform login ulang
3. Save cookies baru untuk session berikutnya

## Advanced Usage

### Command Line Options

```bash
# Mode normal dengan auto CAPTCHA
npm start

# Manual CAPTCHA mode
npm start -- --manual-captcha

# Non-headless mode (untuk debugging)
npm start -- --no-headless
```

<details> 
    <summary> Hidden Note </summary>
    Script ini bakal tetep jalan sampe pihak unindra patch method nya... Hehe
</details>
