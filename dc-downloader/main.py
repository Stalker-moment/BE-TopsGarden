import tkinter as tk
from tkinter import ttk, filedialog, scrolledtext, messagebox
import discord
from discord.ext import commands # Pastikan import ini ada
import os
import aiohttp
import asyncio
import json
import threading
import sys

# --- Konfigurasi (Sesuaikan!) ---
# PERINGATAN: Menyimpan token di sini SANGAT TIDAK AMAN.
# Ganti dengan token user Discord Anda yang sebenarnya.
DISCORD_TOKEN = "NTUwNjMwNDI5NDUyMDA5NDcz.GdMZMf.ls3d0kan7CeujOoyZvqJAGPuYEOZD-SSQFWrec" # <<< GANTI INI!

DEFAULT_DOWNLOAD_DIR = "downloads_thread"
PROGRESS_FILE = "progress_thread.json"
MEDIA_LIMIT_PER_MIN = 10

# Jenis media yang diizinkan
MEDIA_TYPES = ["image", "video"]
EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".mp4", ".mov", ".webm", ".mkv"]

# Cek apakah token sudah diisi
if DISCORD_TOKEN == "MASUKKAN_TOKEN_ANDA_DI_SINI":
    print("\n" + "="*50)
    print(" KESALAHAN KONFIGURASI ".center(50, "="))
    print(" Anda belum mengganti DISCORD_TOKEN di dalam kode.")
    print(" Harap edit file .py ini dan masukkan token Anda.")
    print(" Skrip tidak akan berjalan sampai token diisi.")
    print(" INGAT RISIKO PENGGUNAAN SELF-BOT & HARDCODING TOKEN!")
    print("="*50 + "\n")
    sys.exit("Token belum dikonfigurasi.") # Hentikan eksekusi

# --- Fungsi Inti (sedikit dimodifikasi untuk callback GUI) ---

def load_progress():
    if os.path.exists(PROGRESS_FILE):
        try:
            with open(PROGRESS_FILE, "r") as f:
                return json.load(f)
        except json.JSONDecodeError:
            print(f"⚠️ Warning: Could not decode {PROGRESS_FILE}. Starting fresh.")
            return {}
        except Exception as e:
            print(f"⚠️ Error loading progress: {e}. Starting fresh.")
            return {}
    return {}

def save_progress(message_id):
    try:
        with open(PROGRESS_FILE, "w") as f:
            json.dump({"last_message_id": message_id}, f)
    except Exception as e:
        print(f"❌ Error saving progress: {e}")

# --- Class GUI ---
class DiscordDownloaderApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Discord Thread Media Downloader (Token Hardcoded)")
        self.root.geometry("650x500") # Ukuran window bisa sedikit lebih kecil

        # --- Style / Tema Dark Mode ---
        self.style = ttk.Style()
        self.style.theme_use('clam')

        dark_bg = "#2e2e2e"
        light_fg = "#e1e1e1"
        entry_bg = "#3c3c3c"
        button_bg = "#555555"
        button_fg = light_fg
        button_active = "#666666"

        self.root.configure(bg=dark_bg)
        self.style.configure('.', background=dark_bg, foreground=light_fg)
        self.style.configure('TLabel', background=dark_bg, foreground=light_fg, padding=5)
        self.style.configure('TButton', background=button_bg, foreground=button_fg, padding=5, borderwidth=1)
        self.style.map('TButton', background=[('active', button_active)])
        self.style.configure('TEntry', fieldbackground=entry_bg, foreground=light_fg, insertcolor=light_fg, borderwidth=1)
        self.style.configure('TFrame', background=dark_bg)

        # --- Variabel Tkinter ---
        # self.token_var = tk.StringVar() # Dihapus
        self.thread_id_var = tk.StringVar()
        self.download_dir_var = tk.StringVar(value=DEFAULT_DOWNLOAD_DIR)
        self.status_var = tk.StringVar(value="Status: Idle")

        # --- Konten GUI ---
        main_frame = ttk.Frame(root, padding="10")
        main_frame.pack(expand=True, fill=tk.BOTH)

        input_frame = ttk.Frame(main_frame, padding="10")
        input_frame.pack(fill=tk.X, pady=5)

        # Input Token dihapus dari GUI

        # Thread ID (Sekarang di baris 0)
        ttk.Label(input_frame, text="Thread ID:").grid(row=0, column=0, sticky=tk.W, padx=5, pady=5)
        self.thread_id_entry = ttk.Entry(input_frame, textvariable=self.thread_id_var, width=50)
        self.thread_id_entry.grid(row=0, column=1, sticky=tk.EW, padx=5, pady=5)

        # Download Directory (Sekarang di baris 1)
        ttk.Label(input_frame, text="Folder Download:").grid(row=1, column=0, sticky=tk.W, padx=5, pady=5)
        self.dir_entry = ttk.Entry(input_frame, textvariable=self.download_dir_var, width=40)
        self.dir_entry.grid(row=1, column=1, sticky=tk.EW, padx=5, pady=5)
        self.browse_button = ttk.Button(input_frame, text="Browse", command=self.browse_directory)
        self.browse_button.grid(row=1, column=2, sticky=tk.W, padx=5, pady=5)

        # Konfigurasi kolom grid agar entry bisa expand
        input_frame.columnconfigure(1, weight=1)

        # Tombol Start/Stop
        self.start_button = ttk.Button(main_frame, text="Mulai Download", command=self.start_download_thread)
        self.start_button.pack(pady=10, fill=tk.X, padx=10)

        # Area Status / Log
        ttk.Label(main_frame, text="Log Aktivitas:").pack(anchor=tk.W, padx=10)
        self.log_area = scrolledtext.ScrolledText(main_frame, height=15, width=70, wrap=tk.WORD,
                                                  bg=entry_bg, fg=light_fg, relief=tk.FLAT, bd=2)
        self.log_area.pack(expand=True, fill=tk.BOTH, padx=10, pady=5)
        self.log_area.configure(state='disabled')

        # Status Bar
        self.status_label = ttk.Label(root, textvariable=self.status_var, relief=tk.SUNKEN, anchor=tk.W, padding=3)
        self.status_label.pack(side=tk.BOTTOM, fill=tk.X)

        # --- Variabel State ---
        self.download_thread = None
        self.is_running = False
        self.bot_instance = None
        self.loop = None

        # --- Peringatan Self-Bot & Hardcoding ---
        self.add_log_message("PERINGATAN KERAS:", "red")
        self.add_log_message("- Menggunakan User Token (Self-Bot) melanggar TOS Discord.", "yellow")
        self.add_log_message("- Menyimpan token di kode SANGAT TIDAK AMAN.", "yellow")
        self.add_log_message("- Akun Anda berisiko diblokir. Gunakan dengan kesadaran penuh!", "yellow")
        self.add_log_message("-" * 30)


    def add_log_message(self, message, color="white"):
        """Menambahkan pesan ke area log (thread-safe)"""
        def _update_log():
            self.log_area.configure(state='normal')
            tag_name = f"color_{color.replace('#', '')}" # Buat nama tag unik
            if tag_name not in self.log_area.tag_names():
                 self.log_area.tag_config(tag_name, foreground=color)
            self.log_area.insert(tk.END, message + "\n", tag_name)
            self.log_area.configure(state='disabled')
            self.log_area.see(tk.END)
        self.root.after(0, _update_log)

    def set_status(self, message):
        """Mengatur teks di status bar (thread-safe)"""
        def _update_status():
            self.status_var.set(f"Status: {message}")
        self.root.after(0, _update_status)

    def browse_directory(self):
        """Membuka dialog pemilihan folder"""
        directory = filedialog.askdirectory()
        if directory:
            self.download_dir_var.set(directory)

    def validate_inputs(self):
        """Memvalidasi input (tanpa token) sebelum memulai"""
        # Token tidak divalidasi di sini karena sudah hardcoded
        thread_id_str = self.thread_id_var.get()
        download_dir = self.download_dir_var.get()

        if not thread_id_str:
            messagebox.showerror("Error Input", "Thread ID tidak boleh kosong.")
            return None, None
        if not download_dir:
            messagebox.showerror("Error Input", "Folder Download tidak boleh kosong.")
            return None, None

        try:
            thread_id = int(thread_id_str)
        except ValueError:
            messagebox.showerror("Error Input", "Thread ID harus berupa angka.")
            return None, None

        return thread_id, download_dir

    def start_download_thread(self):
        """Memulai proses download di thread terpisah"""
        if self.is_running:
            messagebox.showwarning("Sedang Berjalan", "Proses download sudah berjalan.")
            return

        # Validasi hanya thread_id dan download_dir
        thread_id, download_dir = self.validate_inputs()
        if not thread_id or not download_dir:
            return

        # Gunakan token yang sudah di-hardcode
        token = DISCORD_TOKEN # Mengambil dari konstanta

        try:
            if not os.path.exists(download_dir):
                os.makedirs(download_dir)
                self.add_log_message(f"Folder '{download_dir}' dibuat.")
        except OSError as e:
             messagebox.showerror("Error Folder", f"Gagal membuat folder '{download_dir}': {e}")
             self.set_status("Error pembuatan folder")
             return

        self.is_running = True
        self.start_button.config(text="Mengunduh...", state=tk.DISABLED)
        self.set_status("Memulai...")
        self.add_log_message("--- Memulai Proses Download ---")

        self.download_thread = threading.Thread(
            target=self.run_download_logic,
            # Kirim token, thread_id, download_dir ke fungsi target
            args=(token, thread_id, download_dir),
            daemon=True
        )
        self.download_thread.start()

    def run_download_logic(self, token, thread_id, download_dir):
        """Logika inti bot yang berjalan di thread terpisah"""
        try:
            self.loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self.loop)

            intents = discord.Intents.default()
            # intents.message_content = True # Mungkin diperlukan tergantung versi discord.py dan apa yang diakses
            self.bot_instance = commands.Bot(command_prefix="!", self_bot=True, intents=intents, loop=self.loop)

            @self.bot_instance.event
            async def on_ready():
                self.add_log_message(f"🔓 Berhasil login sebagai {self.bot_instance.user}")
                self.set_status(f"Login sebagai {self.bot_instance.user}")

                try:
                    thread = await self.bot_instance.fetch_channel(thread_id)
                    if not isinstance(thread, discord.Thread):
                         self.add_log_message(f"❌ ID {thread_id} bukan ID Thread yang valid.", "red")
                         self.set_status("Error: ID bukan thread")
                         await self.stop_bot_safely()
                         return
                    self.add_log_message(f"🎯 Ditemukan Thread: {thread.name} (ID: {thread.id})")

                except discord.NotFound:
                    self.add_log_message(f"❌ Thread dengan ID {thread_id} tidak ditemukan.", "red")
                    self.set_status("Error: Thread tidak ditemukan")
                    await self.stop_bot_safely()
                    return
                except discord.Forbidden:
                    self.add_log_message(f"❌ Tidak punya izin untuk mengakses thread ID {thread_id}.", "red")
                    self.add_log_message("   Pastikan token user valid dan punya akses ke thread.", "yellow")
                    self.set_status("Error: Tidak ada izin")
                    await self.stop_bot_safely()
                    return
                except Exception as e:
                    self.add_log_message(f"❌ Error saat mengambil thread: {e}", "red")
                    self.set_status("Error fetch thread")
                    await self.stop_bot_safely()
                    return

                progress = load_progress()
                after_message_id = progress.get("last_message_id")
                if after_message_id:
                    self.add_log_message(f"Memulai dari pesan setelah ID: {after_message_id}")
                    try:
                        after_message_obj = discord.Object(id=int(after_message_id))
                    except ValueError:
                        self.add_log_message(f"⚠️ ID pesan di progress file ({after_message_id}) tidak valid. Memulai dari awal.", "yellow")
                        after_message_obj = None
                else:
                    self.add_log_message("Memulai dari awal thread.")
                    after_message_obj = None

                total_downloaded = 0
                media_downloaded_since_sleep = 0
                last_saved_message_id = after_message_id

                connector = aiohttp.TCPConnector(ssl=False)
                async with aiohttp.ClientSession(connector=connector) as session:
                    history_limit = 100
                    while self.is_running:
                        self.set_status(f"Mengambil {history_limit} pesan berikutnya...")
                        messages_batch = []
                        try:
                            async for msg in thread.history(limit=history_limit, after=after_message_obj, oldest_first=True):
                                if not self.is_running: break
                                messages_batch.append(msg)
                                after_message_obj = msg
                        except discord.Forbidden:
                             self.add_log_message("❌ Kehilangan akses ke thread saat mengambil history.", "red")
                             self.set_status("Error: Kehilangan akses")
                             break
                        except Exception as e:
                            self.add_log_message(f"❌ Error saat mengambil history: {e}", "red")
                            self.set_status(f"Error history: {e}")
                            await asyncio.sleep(10)
                            continue

                        if not self.is_running: break

                        if not messages_batch:
                            self.add_log_message("✅ Tidak ada pesan baru. Selesai.", "green")
                            self.set_status("Selesai")
                            break

                        self.add_log_message(f"Memproses {len(messages_batch)} pesan...")

                        for message in messages_batch:
                            if not self.is_running: break

                            for attachment in message.attachments:
                                if not self.is_running: break

                                content_type = getattr(attachment, "content_type", None)
                                filename = attachment.filename
                                ext = os.path.splitext(filename)[1].lower()

                                is_media = (
                                    (content_type and any(content_type.startswith(mt) for mt in MEDIA_TYPES)) or
                                    (ext and ext in EXTENSIONS)
                                )

                                if not is_media:
                                    continue

                                clean_filename = "".join(c for c in filename if c.isalnum() or c in ('.', '_', '-')).strip()
                                if not clean_filename: clean_filename = f"file_{attachment.id}{ext or '.dat'}"
                                local_filename = f"{message.id}_{clean_filename}"
                                filepath = os.path.join(download_dir, local_filename)

                                if not os.path.exists(filepath):
                                    self.set_status(f"Mengunduh {local_filename}...")
                                    try:
                                        async with session.get(attachment.url) as resp:
                                            if resp.status == 200:
                                                with open(filepath, "wb") as f:
                                                    f.write(await resp.read())
                                                self.add_log_message(f"✅ Tersimpan: {local_filename}", "cyan")
                                                total_downloaded += 1
                                                media_downloaded_since_sleep += 1

                                                if media_downloaded_since_sleep >= MEDIA_LIMIT_PER_MIN:
                                                    self.add_log_message(f"⏳ Mencapai limit {MEDIA_LIMIT_PER_MIN} media/menit. Jeda 60 detik...", "orange")
                                                    self.set_status("Jeda rate limit...")
                                                    await asyncio.sleep(60)
                                                    media_downloaded_since_sleep = 0
                                                    self.set_status("Melanjutkan...")

                                            elif resp.status == 403:
                                                self.add_log_message(f"⚠️ Gagal (403 Forbidden): {attachment.url} - Mungkin perlu otentikasi ulang?", "yellow")
                                            else:
                                                self.add_log_message(f"⚠️ Gagal ({resp.status}): {attachment.url}", "yellow")
                                    except aiohttp.ClientError as ce:
                                         self.add_log_message(f"❌ Error koneksi saat mengunduh {attachment.url}: {ce}", "red")
                                    except Exception as e:
                                        self.add_log_message(f"❌ Error tidak diketahui saat mengunduh {attachment.url}: {e}", "red")
                                        if os.path.exists(filepath):
                                            try: os.remove(filepath)
                                            except OSError: pass
                                else:
                                    pass

                            if not self.is_running: break

                            if message.id != last_saved_message_id:
                                save_progress(message.id)
                                last_saved_message_id = message.id

                        if not self.is_running:
                             self.add_log_message("--- Proses dihentikan oleh pengguna ---", "yellow")
                             self.set_status("Dihentikan")
                             break

                    if self.is_running:
                        self.add_log_message(f"🎉 Selesai mengunduh. Total {total_downloaded} media baru.", "green")
                        self.set_status("Selesai")

                await self.stop_bot_safely()

            @self.bot_instance.event
            async def on_error(event, *args, **kwargs):
                 self.add_log_message(f"❌ Error Discord.py ({event}): {sys.exc_info()[1]}", "red")
                 if isinstance(sys.exc_info()[1], (discord.LoginFailure, discord.ConnectionClosed)):
                     await self.stop_bot_safely()

            try:
                # Langsung gunakan token dari argumen fungsi
                self.loop.run_until_complete(self.bot_instance.start(token))

            except discord.LoginFailure:
                self.add_log_message("❌ Gagal Login: Token tidak valid.", "red")
                self.set_status("Error Login: Token Salah")
            except discord.PrivilegedIntentsRequired:
                 self.add_log_message("❌ Error Intents: Bot memerlukan Privileged Intents.", "red")
                 self.set_status("Error: Intents diperlukan")
            except Exception as e:
                self.add_log_message(f"❌ Error saat menjalankan bot: {e}", "red")
                self.set_status(f"Error: {e}")
            finally:
                if self.bot_instance and not self.bot_instance.is_closed():
                    self.loop.run_until_complete(self.stop_bot_safely())
                if self.loop.is_running():
                     self.loop.stop()

        except Exception as e:
            self.add_log_message(f"❌ Critical error in download thread: {e}", "red")
            self.set_status(f"Critical Error: {e}")
        finally:
             self.root.after(0, self.cleanup_resources)

    async def stop_bot_safely(self):
        """Mencoba logout dan menutup koneksi bot."""
        if self.bot_instance and not self.bot_instance.is_closed():
            try:
                self.add_log_message("Mencoba logout dari Discord...")
                await self.bot_instance.close()
                self.add_log_message("Koneksi bot ditutup.")
            except Exception as e:
                self.add_log_message(f"⚠️ Error saat menutup bot: {e}", "yellow")

    def cleanup_resources(self):
        """Membersihkan state setelah selesai atau error (dipanggil di main thread)"""
        self.is_running = False
        self.start_button.config(text="Mulai Download", state=tk.NORMAL)
        if self.loop and self.loop.is_running():
            self.loop.stop()
        self.bot_instance = None
        self.loop = None
        self.download_thread = None
        self.add_log_message("--- Proses Selesai / Dihentikan ---")

    def on_closing(self):
        """Dipanggil saat window ditutup"""
        if self.is_running:
            if messagebox.askyesno("Konfirmasi Keluar", "Proses download sedang berjalan. Apakah Anda yakin ingin keluar? Proses akan dihentikan."):
                self.add_log_message("Menghentikan proses karena window ditutup...", "yellow")
                self.is_running = False
                self.root.after(500, self._force_destroy)
            else:
                return
        else:
            self.root.destroy()

    def _force_destroy(self):
         self.root.destroy()

# --- Main Execution ---
if __name__ == "__main__":
    # Pastikan token sudah diisi sebelum membuat GUI
    if DISCORD_TOKEN != "MASUKKAN_TOKEN_ANDA_DI_SINI":
        root = tk.Tk()
        app = DiscordDownloaderApp(root)
        root.protocol("WM_DELETE_WINDOW", app.on_closing)
        root.mainloop()
    # Jika token belum diisi, pesan error sudah dicetak sebelumnya dan skrip berhenti.