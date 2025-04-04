import psutil
import platform
from datetime import datetime

def get_system_info():
    # Informasi Sistem Operasi
    uname = platform.uname()
    system_info = {
        "System": uname.system,
        "Node Name": uname.node,
        "Release": uname.release,
        "Version": uname.version,
        "Machine": uname.machine,
        "Processor": uname.processor,
    }
    
    # Informasi CPU
    cpu_info = {
        "Physical Cores": psutil.cpu_count(logical=False),
        "Total Cores": psutil.cpu_count(logical=True),
        "Max Frequency": f"{psutil.cpu_freq().max:.2f} MHz",
        "Min Frequency": f"{psutil.cpu_freq().min:.2f} MHz",
        "Current Frequency": f"{psutil.cpu_freq().current:.2f} MHz",
        "CPU Usage Per Core": [f"{usage}%" for usage in psutil.cpu_percent(percpu=True, interval=1)],
        "Total CPU Usage": f"{psutil.cpu_percent()}%",
    }
    
    # Informasi RAM
    svmem = psutil.virtual_memory()
    ram_info = {
        "Total": f"{svmem.total / 1e+9:.2f} GB",
        "Available": f"{svmem.available / 1e+9:.2f} GB",
        "Used": f"{svmem.used / 1e+9:.2f} GB",
        "Percentage": f"{svmem.percent}%",
    }
    
    # Informasi Disk
    partitions = psutil.disk_partitions()
    disk_info = []
    for partition in partitions:
        try:
            partition_usage = psutil.disk_usage(partition.mountpoint)
            disk_info.append({
                "Device": partition.device,
                "Mountpoint": partition.mountpoint,
                "File System Type": partition.fstype,
                "Total Size": f"{partition_usage.total / 1e+9:.2f} GB",
                "Used": f"{partition_usage.used / 1e+9:.2f} GB",
                "Free": f"{partition_usage.free / 1e+9:.2f} GB",
                "Percentage": f"{partition_usage.percent}%",
            })
        except PermissionError:
            continue

    # Informasi Suhu
    try:
        temps = psutil.sensors_temperatures()
        temp_info = {name: [{"Label": t.label, "Current": f"{t.current}°C"} for t in entries] for name, entries in temps.items()}
    except AttributeError:
        temp_info = "Temperature sensors are not supported on this system."

    # Informasi GPU (menggunakan pustaka opsional `GPUtil`)
    try:
        import GPUtil
        gpus = GPUtil.getGPUs()
        gpu_info = [{
            "GPU Name": gpu.name,
            "Load": f"{gpu.load * 100:.0f}%",
            "Free Memory": f"{gpu.memoryFree} MB",
            "Used Memory": f"{gpu.memoryUsed} MB",
            "Total Memory": f"{gpu.memoryTotal} MB",
            "Temperature": f"{gpu.temperature}°C",
        } for gpu in gpus]
    except ImportError:
        gpu_info = "GPUtil library is not installed. Run 'pip install gputil' to get GPU information."
    
    # Waktu Boot
    boot_time = datetime.fromtimestamp(psutil.boot_time())
    boot_info = boot_time.strftime("%Y-%m-%d %H:%M:%S")
    
    return {
        "System Info": system_info,
        "CPU Info": cpu_info,
        "RAM Info": ram_info,
        "Disk Info": disk_info,
        "Temperature Info": temp_info,
        "GPU Info": gpu_info,
        "Boot Time": boot_info,
    }

# Menampilkan informasi sistem
import pprint
pprint.pprint(get_system_info())
