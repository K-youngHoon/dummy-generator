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
const inquirer = require("inquirer");
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
    const chunk = Buffer.alloc(Math.min(sizeBytes, 1024 * 1024), 0);
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
  try {
    const image = new Jimp.Jimp({
      width,
      height,
      color: "#ffffffff", // 흰색 배경
    });

    image.write(filePath);

    console.log(`이미지 저장 성공: ${filePath}`);
  } catch (err) {
    // Jimp.create 또는 writeAsync에서 발생한 오류를 여기서 처리합니다.
    console.error("이미지 처리 중 오류 발생:", err);
    // 오류를 다시 throw하여 이 함수를 호출한 곳에서 catch할 수 있도록 합니다.
    throw new Error(`이미지 저장 실패: ${err.message}`);
  }
}

async function createXlsxWithSize(filePath, sizeBytes) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");

  console.log("▶ 랜덤 데이터 생성 중...");
  const randomBytes = crypto.randomBytes(sizeBytes);
  const randomText = randomBytes.toString("hex");

  sheet.getCell("A1").value = randomText;

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
      when: (answers) => !isImageExt(answers.ext),
      validate: (v) => !!v || "입력 필요",
    },
    {
      name: "filename",
      message: "파일명",
      default: "dummy",
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
  const sizeBytes = answers.size ? parseSizeToBytes(answers.size) : 0;
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
  const baseDir = "C:\\Users\\user\\Desktop";

  // 생성 루프
  for (let i = 1; i <= count; i++) {
    const fname = filenameTemplate.includes("{n}")
      ? filenameTemplate.replace("{n}", String(i))
      : count === 1
      ? filenameTemplate
      : `${filenameTemplate}${i}`;
    const outPath = path.join(baseDir, `${fname}.${ext}`);
    console.log(`-> 생성중: ${outPath} (목표: ${sizeBytes} bytes)`);

    try {
      if (isImageExt(ext)) {
        await createWhiteImage(
          outPath,
          imgDim.width,
          imgDim.height,
          imgDim.format
        );
        console.log(`   이미지 생성 완료: ${outPath})`);
      } else if (ext === "xlsx") {
        await createXlsxWithSize(outPath, sizeBytes);
        console.log(
          `   xlsx 생성 완료: ${outPath} (${fs.statSync(outPath).size} bytes)`
        );
      } else {
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
