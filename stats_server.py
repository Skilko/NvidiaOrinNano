import subprocess
import re
from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
# Allow requests from any origin, which is fine for local development.
CORS(app)

def parse_tegrastats(line):
    """Parses a single line of output from the tegrastats utility."""
    stats = {}

    # RAM: 1683/7762MB  (sometimes the colon may be absent/present)
    ram_match = re.search(r"RAM[:\s]+(\d+)/(\d+)MB", line)
    if ram_match:
        stats['ram_used_mb'] = int(ram_match.group(1))
        stats['ram_total_mb'] = int(ram_match.group(2))
        stats['ram_used_gb'] = round(int(ram_match.group(1)) / 1024, 2)
        stats['ram_total_gb'] = round(int(ram_match.group(2)) / 1024, 2)

    # CPU: [11%@1113,8%@1113,9%@1113,10%@1113,8%@1113,9%@1113]
    cpu_match = re.search(r"CPU \[(.*?)\]", line)
    if cpu_match:
        cpu_cores = re.findall(r"(\d+)%@\d+", cpu_match.group(1))
        if cpu_cores:
            total_percent = sum(int(p) for p in cpu_cores)
            stats['cpu_usage_percent'] = round(total_percent / len(cpu_cores), 2)

    # GR3D_FREQ 15%@114  or  GR3D_FREQ 0%
    gpu_match = re.search(r"GR3D_FREQ (\d+)%(?:@\d+)?", line)
    if gpu_match:
        stats['gpu_usage_percent'] = int(gpu_match.group(1))

    # SOC_TEMP 35.5C
    temp_match = re.search(r"SOC_TEMP (\d+\.\d+)C", line)
    if temp_match:
        stats['soc_temp_c'] = float(temp_match.group(1))

    return stats

@app.route('/api/system-stats')
def get_system_stats():
    """
    Runs tegrastats for a brief moment, captures the output,
    parses it, and returns it as JSON.
    """
    try:
        # Run tegrastats and grab a single line of output. Some builds of the
        # utility (e.g. JetPack 5.x) do NOT support the "--count" flag, so we
        # simply start it, read one line, and terminate.

        proc = subprocess.Popen(
            ['tegrastats', '--interval', '100'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # Read exactly one line of stats
        output_line = proc.stdout.readline().strip()

        # We no longer need the process – terminate it politely. If it is
        # already gone this is a no-op.
        proc.terminate()
        try:
            proc.wait(timeout=0.2)
        except subprocess.TimeoutExpired:
            proc.kill()

        parsed_stats = parse_tegrastats(output_line)

        # Even if some keys are missing, return whatever we managed to parse.
        # If nothing could be parsed, return an error so the caller knows.
        if not parsed_stats:
            return jsonify({"error": "Failed to parse tegrastats output", "raw": output_line}), 500

        return jsonify(parsed_stats)

    except FileNotFoundError:
        return jsonify({"error": "'tegrastats' command not found. Are you running this on a Jetson device?"}), 500
    except subprocess.CalledProcessError as e:
        return jsonify({"error": "Error running tegrastats", "details": str(e)}), 500
    except Exception as e:
        return jsonify({"error": "An unexpected error occurred", "details": str(e)}), 500

if __name__ == '__main__':
    print("Starting Jetson Stats Server on http://localhost:5001")
    # Host 0.0.0.0 makes it accessible from other devices on your network
    app.run(host='0.0.0.0', port=5001)
        