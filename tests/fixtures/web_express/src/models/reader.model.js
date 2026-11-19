import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

const Reader = sequelize.define('Reader', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false, unique: true },
}, { tableName: 'readers' });

export default Reader;
