import * as libraryService from '../services/library.service.js';

export const addBook = async (req, res, next) => {
  try {
    const book = await libraryService.addBook(req.body);
    return res.status(201).json(book);
  } catch (err) {
    return next(err);
  }
};

export const getBook = async (req, res, next) => {
  try {
    const { isbn } = req.params;
    const book = await libraryService.getBook(isbn);
    return res.json(book);
  } catch (err) {
    return next(err);
  }
};

export const getReader = async (req, res) => res.json(await libraryService.getReader(req.params.id));

export const removeReader = async (req, res) => {
  await libraryService.removeReader(req.params.id);
  res.sendStatus(204);
};
