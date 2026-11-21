'use strict';

const jsonStore = require('./jsonStore');
const { getTicketConfig } = require('../config/loadConfig');
const { validateTicketConfig } = require('./preflight');

// The shipped categories live in config/tickets.json. Edits made through /ticket are written as
// a complete category array in DATA_DIR/ticket-types.json and override the shipped list, so a
// redeploy never wipes the server's own setup.
const FILE = 'ticket-types.json';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validate(types) {
  const config = { ...getTicketConfig(), types };
  const result = validateTicketConfig(config);
  if (result.errors.length) throw new Error(result.errors[0]);
}

async function listTypes() {
  return clone(getTicketConfig().types || []);
}

async function getType(id) {
  return (await listTypes()).find((type) => type.id === id) || null;
}

async function saveTypes(types) {
  validate(types);
  await jsonStore.writeJson(FILE, types);
  return clone(types);
}

async function addType(type) {
  const types = await listTypes();
  if (types.some((candidate) => candidate.id === type.id)) {
    throw new Error(`Category "${type.id}" already exists.`);
  }
  types.push({
    supportRoleId: '',
    pingSupport: true,
    claimEnabled: true,
    ratingEnabled: true,
    maxOpen: null,
    questions: [],
    ...type,
  });
  return saveTypes(types);
}

async function updateType(id, patch) {
  const types = await listTypes();
  const index = types.findIndex((type) => type.id === id);
  if (index === -1) throw new Error(`Category "${id}" does not exist.`);
  types[index] = { ...types[index], ...patch, id };
  return saveTypes(types);
}

async function removeType(id) {
  const types = await listTypes();
  if (!types.some((type) => type.id === id)) throw new Error(`Category "${id}" does not exist.`);
  return saveTypes(types.filter((type) => type.id !== id));
}

async function addQuestion(typeId, question) {
  const types = await listTypes();
  const type = types.find((candidate) => candidate.id === typeId);
  if (!type) throw new Error(`Category "${typeId}" does not exist.`);
  type.questions = Array.isArray(type.questions) ? type.questions : [];
  if (type.questions.length >= 5) throw new Error('A Discord ticket form allows at most 5 questions.');
  if (type.questions.some((candidate) => candidate.id === question.id)) {
    throw new Error(`Question "${question.id}" already exists in this category.`);
  }
  type.questions.push(question);
  return saveTypes(types);
}

async function updateQuestion(typeId, questionId, patch) {
  const types = await listTypes();
  const type = types.find((candidate) => candidate.id === typeId);
  if (!type) throw new Error(`Category "${typeId}" does not exist.`);
  const question = (type.questions || []).find((candidate) => candidate.id === questionId);
  if (!question) throw new Error(`Question "${questionId}" does not exist.`);
  Object.assign(question, patch, { id: questionId });
  return saveTypes(types);
}

async function removeQuestion(typeId, questionId) {
  const types = await listTypes();
  const type = types.find((candidate) => candidate.id === typeId);
  if (!type) throw new Error(`Category "${typeId}" does not exist.`);
  const before = (type.questions || []).length;
  type.questions = (type.questions || []).filter((candidate) => candidate.id !== questionId);
  if (type.questions.length === before) throw new Error(`Question "${questionId}" does not exist.`);
  return saveTypes(types);
}

async function resetTypes() {
  await jsonStore.writeJson(FILE, null);
  return listTypes();
}

module.exports = {
  FILE,
  validate,
  listTypes,
  getType,
  saveTypes,
  addType,
  updateType,
  removeType,
  addQuestion,
  updateQuestion,
  removeQuestion,
  resetTypes,
};
