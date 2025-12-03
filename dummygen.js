#!/usr/bin/env node
/**
 * dummygen.js
 * - 확장자, 용량 입력
 * - 이미지 확장자일 경우 가로/세로 입력 (흰 배경)
 * - xlsx는 실제 엑셀 파일로 생성하고 필요하면 더미 데이터를 추가해 용량 맞춤
 *
 * 사용:
 *   node dummygen.js
 *
 * 패키징 (윈도우 exe):
 *   npm i -g pkg
 *   pkg dummygen.js --targets node18-win-x64
 */

const fs = require("fs");
const path = require("path");
const inquirer = require("inquirer").default;
const Jimp = require("jimp");
const ExcelJS = require("exceljs");
const crypto = require("crypto");

async function createTxtFile(filePath, sizeBytes) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    let written = 0;
    const chunkSize = 1024 * 1024; // 1MB
    const chunk = Buffer.alloc(chunkSize, 0);

    function write() {
      let ok = true;

      while (written < sizeBytes && ok) {
        const remaining = sizeBytes - written;
        const toWrite =
          remaining >= chunkSize ? chunk : Buffer.alloc(remaining, 0);

        ok = stream.write(toWrite);

        written += toWrite.length;
      }

      if (written >= sizeBytes) {
        stream.end();
      } else {
        stream.once("drain", write);
      }
    }

    stream.on("finish", resolve);
    stream.on("error", reject);

    write();
  });
}

function parseSizeToBytes(sizeStr) {
  // 허용 예: 10, 10B, 10KB, 1MB, 2.5GB (단위 대소문자 허용)
  const s = String(sizeStr).trim().toUpperCase();
  const m = s.match(/^([\d,.]+)\s*(B|KB|MB|GB)?$/);
  if (!m) throw new Error("사이즈 포맷이 잘못되었습니다. 예: 10MB, 512KB, 100");
  const num = parseFloat(m[1].replace(",", ""));
  const unit = m[2] || "B";
  const mul = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[unit];
  return Math.round(num * mul);
}

async function createRawFile(filePath, sizeBytes) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath, { flags: "w" });
    const chunk = Buffer.alloc(Math.min(sizeBytes, 1024 * 1024), 0); // 1MB chunk
    let written = 0;
    function writeNext() {
      while (written < sizeBytes) {
        const remaining = sizeBytes - written;
        const toWrite =
          remaining >= chunk.length ? chunk : Buffer.alloc(remaining, 0);
        if (!stream.write(toWrite)) {
          stream.once("drain", writeNext);
          return;
        }
        written += toWrite.length;
      }
      stream.end();
    }
    stream.on("finish", () => resolve());
    stream.on("error", (err) => reject(err));
    writeNext();
  });
}

async function createWhiteImage(filePath, width, height, format) {
  console.log(filePath, width, height, format);
  return new Promise((resolve, reject) => {
    // 💡 1. 흰색 픽셀 데이터를 생성합니다 (0xFFFFFFFF = 투명도 포함된 흰색)
    // const totalPixels = width * height;
    const whiteHex = "0xffffffff"; // RGBA (255, 255, 255, 255)

    // 💡 2. Uint32Array는 각 픽셀(4바이트)을 32비트 정수로 저장합니다.
    // const data = new Uint32Array(totalPixels).fill(whiteHex);

    // // 💡 3. Jimp 생성자에 'data', 'width', 'height' 순서로 전달합니다.
    // // data는 반드시 Buffer 또는 ArrayBuffer/Uint8Array 형태여야 합니다.
    // // Uint32Array.buffer는 ArrayBuffer이므로 직접 Buffer로 변환합니다.
    // const bufferData = Buffer.from(data.buffer);

    // `new Jimp(data, width, height, cb)` 형식으로 사용
    new Jimp.Jimp(width, height, whiteHex, (err, image) => {
      if (err) return reject(err);

      if (format === "jpg" || format === "jpeg") {
        // .write()는 콜백을 지원합니다.
        image.quality(90).write(filePath, resolve);
      } else {
        image.write(filePath, resolve);
      }
    });
  });
}

async function createXlsxWithSize(filePath, sizeBytes) {
  // 실제 엑셀 파일 생성. 기본은 빈 시트 하나.
  // 파일이 목표보다 작으면 더미 데이터를 반복 추가해 크기를 늘림.
  // 1) 워크북 생성
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");

  // 2) 랜덤 데이터를 한 셀에 몰아넣음
  console.log("▶ 랜덤 데이터 생성 중...");
  const randomBytes = crypto.randomBytes(sizeBytes);
  const randomText = randomBytes.toString("hex"); // hex → 용량 ×2 증가

  // 주의: hex는 1byte → 2글자라 실제 셀 크기가 2배
  // hexSize = targetSize * 2 정도 됨
  sheet.getCell("A1").value = randomText;

  // 3) 파일로 저장
  console.log("▶ 엑셀 파일 압축 및 저장 중...");
  const buffer = await workbook.xlsx.writeBuffer();

  fs.writeFileSync(filePath, buffer);
}

function isImageExt(ext) {
  const e = ext.toLowerCase();
  return ["png", "jpg", "jpeg"].includes(e);
}

async function main() {
  const answers = await inquirer.prompt([
    {
      name: "ext",
      message: "파일 확장자 (예: txt, xlsx, png, jpg):",
      validate: (v) => !!v || "입력 필요",
    },
    {
      name: "size",
      message: "원하는 파일 용량 (예: 10MB, 512KB):",
      validate: (v) => !!v || "입력 필요",
    },
    {
      name: "filename",
      message:
        "파일명 (확장자 제외). 여러개 생성하려면 {n} 사용 (예: dummy{n}). 단일이면 그냥 name 입력:",
      default: "dummy{n}",
    },
    {
      name: "count",
      message: "몇 개 생성할까요?",
      default: "1",
      validate: (v) =>
        (Number.isInteger(Number(v)) && Number(v) >= 1) || "숫자 입력",
    },
  ]);

  const ext = answers.ext.replace(/^\./, "").toLowerCase();
  const sizeBytes = parseSizeToBytes(answers.size);
  const filenameTemplate = answers.filename;
  const count = parseInt(answers.count, 10);

  let imgDim = null;
  if (isImageExt(ext)) {
    const imgAnswers = await inquirer.prompt([
      {
        name: "width",
        message: "이미지 너비(px):",
        default: "800",
        validate: (v) =>
          (Number.isInteger(Number(v)) && Number(v) > 0) || "양의 정수 입력",
      },
      {
        name: "height",
        message: "이미지 높이(px):",
        default: "600",
        validate: (v) =>
          (Number.isInteger(Number(v)) && Number(v) > 0) || "양의 정수 입력",
      },
    ]);
    imgDim = {
      width: parseInt(imgAnswers.width, 10),
      height: parseInt(imgAnswers.height, 10),
      format: ext.toLowerCase(),
    };
  }

  // 생성 루프
  for (let i = 1; i <= count; i++) {
    const fname = filenameTemplate.includes("{n}")
      ? filenameTemplate.replace("{n}", String(i))
      : count === 1
      ? filenameTemplate
      : `${filenameTemplate}${i}`;
    const outPath = path.resolve(`${fname}.${ext}`);
    console.log(`-> 생성중: ${outPath} (목표: ${sizeBytes} bytes)`);

    try {
      if (isImageExt(ext)) {
        // 이미지: 지정한 가로/세로의 흰 배경 이미지 생성.
        // 이미지 파일의 실제 파일 크기는 포맷(jpg/png)과 치수에 따라 달라지므로 "정확한 바이트" 보장은 어렵습니다.
        await createWhiteImage(
          outPath,
          imgDim.width,
          imgDim.height,
          imgDim.format
        );
        console.log(`   이미지 생성 완료: ${outPath})`);
        // 사용자가 특정 바이트 크기(예: 1MB 이미지)를 원하면, 이후 raw padding을 추가하는 옵션을 제공할 수 있으나
        // 이는 이미지 파일 포맷에 따라 파일 무결성을 해칠 수 있습니다. 요청 시 옵션 추가 가능.
      } else if (ext === "xlsx") {
        // 실제 xlsx 생성: 내부에 더미 데이터 채워서 목표 용량 맞추기 시도
        await createXlsxWithSize(outPath, sizeBytes);
        console.log(
          `   xlsx 생성 완료: ${outPath} (${fs.statSync(outPath).size} bytes)`
        );
      } else {
        // 그 외: 단순히 0 바이트로 채운 더미 파일 생성
        await createTxtFile(outPath, sizeBytes);
        console.log(
          `   더미 파일 생성 완료: ${outPath} (${
            fs.statSync(outPath).size
          } bytes)`
        );
      }
    } catch (err) {
      console.error("   오류 발생:", err.message || err);
    }
  }

  console.log("완료.");
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
